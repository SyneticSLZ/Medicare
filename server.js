// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const reimbursementRoutes = require('./routes');
const app = express();
const axios = require('axios');
const PORT = process.env.PORT || 3000;

// Middleware for JSON parsing
app.use(express.json());

// Serve static files
app.use(express.static('public'));
app.use(reimbursementRoutes);
// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});



// HCPCS codes
// const hcpcsCodes = ['61885', '61888', '61889', '61891', '61892', '64568', '64569', '64570', '95970', '95976', '95977', '95983'];
const hcpcsCodes = [ '61889', '61891', '61892', '64568', '64569', '64570'];
// API endpoints (2022)
const serviceApiUrl = 'https://data.cms.gov/data-api/v1/dataset/92396110-2aed-4d63-a6a2-5d6207d46a29/data'; // By Provider and Service
const providerApiUrl = 'https://data.cms.gov/data-api/v1/dataset/8889d81e-2ee7-448f-8713-f071038289b5/data'; // By Provider
const geoApiUrl = 'https://data.cms.gov/data-api/v1/dataset/6fea9d79-0129-4e4c-b1b8-23cd86a4f435/data'; // By Geography and Service

// Fetch service data by HCPCS code
async function fetchServiceDataByHcpcs(hcpcsCode) {
  let allResults = [];
  let offset = 0;
  const size = 100;

  try {
    while (true) {
      const response = await axios.get(serviceApiUrl, {
        params: { 'filter[HCPCS_Cd]': hcpcsCode, offset, size },
      });
      const data = response.data;
      console.log(`Service API for ${hcpcsCode} (offset ${offset}): ${data.length}`);
      allResults = allResults.concat(data.filter(item => item.HCPCS_Cd === hcpcsCode));
      if (data.length < size) break;
      offset += size;
    }
    return allResults;
  } catch (error) {
    console.error(`Error fetching service data for ${hcpcsCode}:`, error.message);
    return [];
  }
}

// Fetch provider data by NPIs
async function fetchProviderDataByNpi(npis) {
  let allResults = [];
  let offset = 0;
  const size = 100;

  try {
    while (true) {
      const response = await axios.get(providerApiUrl, {
        params: {
          'filter[Rndrng_NPI][condition][operator]': 'IN',
          'filter[Rndrng_NPI][condition][value]': npis.join(','),
          offset,
          size,
        },
      });
      const data = response.data;
      console.log(`Provider API (offset ${offset}): ${data.length}`);
      allResults = allResults.concat(data);
      if (data.length < size) break;
      offset += size;
    }
    return allResults;
  } catch (error) {
    console.error(`Error fetching provider data:`, error.message);
    return [];
  }
}

// Fetch geography data by HCPCS code
async function fetchGeoDataByHcpcs(hcpcsCode) {
  let allResults = [];
  let offset = 0;
  const size = 100;

  try {
    while (true) {
      const response = await axios.get(geoApiUrl, {
        params: { 'filter[HCPCS_Cd]': hcpcsCode, offset, size },
      });
      const data = response.data;
      console.log(`Geo API for ${hcpcsCode} (offset ${offset}): ${data.length}`);
      allResults = allResults.concat(data.filter(item => item.HCPCS_Cd === hcpcsCode));
      if (data.length < size) break;
      offset += size;
    }
    return allResults;
  } catch (error) {
    console.error(`Error fetching geo data for ${hcpcsCode}:`, error.message);
    return [];
  }
}

// Analyze and enrich market values
function analyzeMarketValues(serviceData, providerData, geoData) {
  const analysis = {};
  const providerMap = new Map(providerData.map(p => [p.Rndrng_NPI, p]));
  const geoMap = new Map();

  // Aggregate geo data
  geoData.forEach(entry => {
    const hcpcs = entry.HCPCS_Cd;
    if (!geoMap.has(hcpcs)) {
      geoMap.set(hcpcs, { facility: {}, office: {} });
    }
    const place = entry.Place_Of_Srvc === 'F' ? 'facility' : 'office';
    geoMap.get(hcpcs)[place] = {
      totalProviders: parseInt(entry.Tot_Rndrng_Prvdrs) || 0,
      totalServices: parseFloat(entry.Tot_Srvcs) || 0,
      totalBeneficiaries: parseInt(entry.Tot_Benes) || 0,
      totalSpending: (parseFloat(entry.Avg_Mdcr_Pymt_Amt) * parseFloat(entry.Tot_Srvcs)) || 0,
    };
  });

  // Analyze service data
  serviceData.forEach(entry => {
    const hcpcs = entry.HCPCS_Cd;
    if (!hcpcsCodes.includes(hcpcs)) return;

    if (!analysis[hcpcs]) {
      analysis[hcpcs] = {
        description: entry.HCPCS_Desc,
        totalServices: 0,
        totalBeneficiaries: 0,
        totalSpending: 0,
        providerCount: 0,
        avgSubmittedCharge: 0,
        avgMedicarePayment: 0,
        marketSize: 0, // National spending
        revenueSplits: { facility: 0, office: 0 },
        providers: [],
        geoSummary: geoMap.get(hcpcs) || { facility: {}, office: {} },
      };
    }

    const record = analysis[hcpcs];
    const services = parseFloat(entry.Tot_Srvcs) || 0;
    const beneficiaries = parseFloat(entry.Tot_Benes) || 0;
    const payment = parseFloat(entry.Avg_Mdcr_Pymt_Amt) * services;

    record.totalServices += services;
    record.totalBeneficiaries += beneficiaries;
    record.totalSpending += payment;
    record.providerCount += 1;
    record.avgSubmittedCharge = (record.avgSubmittedCharge * (record.providerCount - 1) + parseFloat(entry.Avg_Sbmtd_Chrg)) / record.providerCount;
    record.avgMedicarePayment = (record.avgMedicarePayment * (record.providerCount - 1) + parseFloat(entry.Avg_Mdcr_Pymt_Amt)) / record.providerCount;

    const providerInfo = providerMap.get(entry.Rndrng_NPI) || {};
    // record.providers.push({
    //   npi: entry.Rndrng_NPI,
    //   name: `${entry.Rndrng_Prvdr_First_Name} ${entry.Rndrng_Prvdr_Last_Org_Name}`,
    //   state: entry.Rndrng_Prvdr_State_Abrvtn,
    //   specialty: providerInfo.Rndrng_Prvdr_Type || 'Unknown',
    //   totalProviderServices: providerInfo.Tot_Srvcs || 0,
    //   totalProviderSpending: providerInfo.Tot_Mdcr_Pymt_Amt || 0,
    //   beneAvgAge: providerInfo.Bene_Avg_Age || 0,
    //   beneConditions: {
    //     parkinsons: providerInfo.Bene_CC_PH_Parkinson_V2_Pct || 0,
    //     depression: providerInfo.Bene_CC_BH_Depress_V1_Pct || 0,
    //   },
    //   services,
    //   spending: payment,
    // });

    // Update market size and splits
    record.marketSize = (record.geoSummary.facility.totalSpending || 0) + (record.geoSummary.office.totalSpending || 0);
    record.revenueSplits.facility = record.geoSummary.facility.totalSpending || 0;
    record.revenueSplits.office = record.geoSummary.office.totalSpending || 0;
  });

  // Placeholder for company market share (requires external mapping)
  const companyMapping = {
    '61885': { 'Medtronic': 0.6, 'Abbott': 0.3, 'Boston Scientific': 0.1 }, // Example shares
    '64568': { 'Medtronic': 0.5, 'LivaNova': 0.4, 'Other': 0.1 },
    // Add mappings for other codes
  };

  // Object.keys(analysis).forEach(hcpcs => {
  //   const shares = companyMapping[hcpcs] || {};
  //   analysis[hcpcs].marketShare = Object.keys(shares).map(company => ({
  //     company,
  //     share: shares[company],
  //     estimatedSpending: analysis[hcpcs].marketSize * shares[company],
  //   }));
  // });

  return analysis;
}

// API endpoint
app.get('/market-values', async (req, res) => {
  try {
    const servicePromises = hcpcsCodes.map(code => fetchServiceDataByHcpcs(code));
    const geoPromises = hcpcsCodes.map(code => fetchGeoDataByHcpcs(code));
    
    const [serviceResults, geoResults] = await Promise.all([
      Promise.all(servicePromises),
      Promise.all(geoPromises),
    ]);

    const allServiceData = serviceResults.flat();
    const allGeoData = geoResults.flat();
    const uniqueNpis = [...new Set(allServiceData.map(item => item.Rndrng_NPI))];
    const providerData = await fetchProviderDataByNpi(uniqueNpis);

    const marketAnalysis = analyzeMarketValues(allServiceData, providerData, allGeoData);

    res.json({
      status: 'success',
      data: marketAnalysis,
      year: 2022, // Single year for now
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// API endpoint for specific HCPCS code
app.get('/market-values/:hcpcsCode', async (req, res) => {
  try {
    const { hcpcsCode } = req.params;
    
    // Fetch data for the specific HCPCS code
    const servicePromise = fetchServiceDataByHcpcs(hcpcsCode);
    const geoPromise = fetchGeoDataByHcpcs(hcpcsCode);
    
    const [serviceResult, geoResult] = await Promise.all([
      servicePromise,
      geoPromise,
    ]);

    // Handle case where no data is returned
    if (!serviceResult || serviceResult.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: `No service data found for HCPCS code: ${hcpcsCode}`
      });
    }

    // Get unique NPIs from service data
    const uniqueNpis = [...new Set(serviceResult.map(item => item.Rndrng_NPI))];
    const providerData = await fetchProviderDataByNpi(uniqueNpis);

    // Analyze market values for this specific code
    const marketAnalysis = analyzeMarketValues(serviceResult, providerData, geoResult);

    res.json({
      status: 'success',
      data: marketAnalysis,
      hcpcsCode: hcpcsCode,
      year: 2022,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message || `Error processing HCPCS code: ${req.params.hcpcsCode}`
    });
  }
});

// API endpoint to get processed HCPCS data
app.get('/api/hcpcs-data', async (req, res) => {
  try {
    const dataObject = await processAllFiles();
    res.json(dataObject);
  } catch (error) {
    console.error('Error processing files:', error);
    res.status(500).json({ error: 'Failed to process HCPCS data files' });
  }
});

// API endpoint to get processed HCPCS data for a specific directory (618, 645, or 959)
app.get('/api/hcpcs-data/:directory', async (req, res) => {
  try {
    const { directory } = req.params;
    const dataObject = await processAllFiles();
    
    if (!dataObject[directory]) {
      return res.status(404).json({ error: `Data for directory ${directory} not found` });
    }
    
    res.json(dataObject[directory]);
  } catch (error) {
    console.error('Error processing files:', error);
    res.status(500).json({ error: 'Failed to process HCPCS data files' });
  }
});

// Main function to process all files
async function processAllFiles() {
  // Directories to process
  const directories = ['618', '645', '959'];
  
  // Years to process - adjust as needed
  const years = ['2020', '2021', '2022', '2023', '2024A', '2024B', '2025'];
  
  // Object to store data by directory and year
  const allData = {};
  
  // Process each directory
  for (const dir of directories) {
    console.log(`Processing directory: ${dir}`);
    allData[dir] = [];
    
    // Base directory where the files are located
    const baseDir = path.join(__dirname, 'data', dir);
    
    // Check if directory exists
    if (!fs.existsSync(baseDir)) {
      console.warn(`Directory not found: ${baseDir}`);
      continue;
    }
    
    // Process each year
    for (const year of years) {
      console.log(`Processing data for year: ${year} in directory: ${dir}`);
      
      // File pattern: 2020-all-61885-61888-61889-61891-61892-national_payment_amount.csv
      // or similar pattern for other years and directories
      const filePattern = `${year}-all-${dir === '618' ? '61885-61888-61889-61891-61892' : 
                              dir === '645' ? '64568-64569-64570' : 
                              '95970-95976-95977-95983'}-national_payment_amount.csv`;
      
      const filePath = path.join(baseDir, filePattern);
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        allData[dir].push([]); // Push empty array if file doesn't exist
        continue;
      }
      
      // Read and process the file
      const yearData = await readCSVFile(filePath);
      allData[dir].push(yearData);
    }
  }
  
  return allData;
}

// Function to read and parse a CSV file
function readCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    // Read file content as string first
    fs.readFile(filePath, 'utf8', (err, fileContent) => {
      if (err) {
        return reject(err);
      }
      
      try {
        // Parse CSV using PapaParse
        const parsed = Papa.parse(fileContent, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: true,
          transformHeader: header => header.trim().replace(/^"|"$/g, '')
        });
        
        // Check if we got any data
        if (!parsed.data || parsed.data.length === 0) {
          console.warn(`No data found in ${filePath}`);
          return resolve([]);
        }
        
        // Skip the header row if it was accidentally included as data
        // (Sometimes a header row might be parsed as the first data row)
        const firstRow = parsed.data[0];
        const startIndex = (firstRow['HCPCS Code'] === 'HCPCS Code') ? 1 : 0;
        
        // Process the data - clean up values
        const processedData = parsed.data.slice(startIndex).map(row => {
          const cleanedRow = {};
          Object.keys(row).forEach(key => {
            const cleanKey = key.trim().replace(/^"|"$/g, '');
            let value = row[key];
            
            // Handle string values
            if (typeof value === 'string') {
              value = value.replace(/^"|"$/g, '').trim();
            }
            
            cleanedRow[cleanKey] = value;
          });
          return cleanedRow;
        });
        
        console.log(`Finished reading ${filePath}, total records: ${processedData.length}`);
        resolve(processedData);
      } catch (error) {
        console.error(`Error parsing CSV ${filePath}:`, error);
        reject(error);
      }
    });
  });
}

// Function to check and create necessary directories and sample files (for testing)
/**
 * Setup function that creates necessary directories and sample files
 * 
 * This function should be added to your server.js file.
 */
function setupEnvironment() {
  // Create data directory if it doesn't exist
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created directory: ${dataDir}`);
  }
  
  // Directories to create
  const directories = ['618', '645', '959', 'AB'];
  
  // Base sample data for HCPCS code files
  const sampleData = `"HCPCS Code","Modifier","Short Description","Mac Locality","Non-Facility Price","Facility Price","Non-Facility Limiting Charge","Facility Limiting Charge","GPCI Work","GPCI PE","GPCI MP","Proc Stat","Work RVU","NA Flag for Trans Non-FAC PE RVU","Transitioned Non-FAC PE RVU","NA Flag for Fully IMP Non-FAC PE RVU","Fully Implemented Non-FAC PE RVU","NA Flag for Trans facility PE RVU","Transitioned Facility PE RVU","NA Flag for Fully IMP FAC PE RVU","Fully Implemented Facility PE RVU","MP RVU","Transitioned Non-FAC Total","Transitioned Facility Total","Fully Implemented Non-Fac Total","Fully Implemented Facility Total","PCTC","Global","Pre Op","Intra Op","Post Op","Mult Surg","Bilt Surg","Asst Surg","Co Surg","Team Surg","Phys Supv","Endobase","Conv Fact","Not Used for Medicare","Diag Imaging Family Ind","Opps Non-Facility Payment Amount","Opps Facility Payment Amount","Non-Fac PE Used For Opps PMT AMT","Facility PE Used For Opps PMT AMT","Malpractice Used For Opps PMT AMT"`;
  
  // Sample data for each directory
  const sampleDataByDir = {
    '618': sampleData + `\n"61885","","Insrt/redo neurostim 1 array","0000000","NA","$538.82","NA","$588.66","1.000","1.000","1.000","A","6.05","NA","6.76","NA","6.76","","6.76","","6.76","2.12","14.93","14.93","14.93","14.93","0","090","0.11","0.76","0.13","2","1","0","0","0","09","","36.0896","","99","NA","NA","0.00","0.00","0.00"\n"61888","","Revise/remove neuroreceiver","0000000","NA","$411.06","NA","$449.08","1.000","1.000","1.000","A","5.23","NA","4.34","NA","4.34","","4.34","","4.34","1.82","11.39","11.39","11.39","11.39","0","010","0.10","0.80","0.10","2","1","1","0","0","09","","36.0896","","99","NA","NA","0.00","0.00","0.00"`,
    '645': sampleData + `\n"64568","","Inc for vagus n elect impl","0000000","NA","$389.77","NA","$425.88","1.000","1.000","1.000","A","7.98","NA","8.51","NA","8.51","","8.51","","8.51","2.32","18.81","18.81","18.81","18.81","0","090","0.00","0.00","0.00","2","2","2","1","1","09","","36.0896","","99","NA","NA","0.00","0.00","0.00"\n"64569","","Revise/repl vagus n eltrd","0000000","NA","$493.67","NA","$538.67","1.000","1.000","1.000","A","11.00","NA","6.07","NA","6.07","","6.07","","6.07","2.60","19.67","19.67","19.67","19.67","0","090","0.00","0.00","0.00","2","2","2","1","1","09","","36.0896","","99","NA","NA","0.00","0.00","0.00"`,
    '959': sampleData + `\n"95970","","Alys npgt 1 brn npgt prgrmg","0000000","NA","$31.52","NA","$34.39","1.000","1.000","1.000","A","0.35","NA","0.18","NA","0.18","","0.18","","0.18","0.34","0.87","0.87","0.87","0.87","0","XXX","0.00","0.00","0.00","3","1","0","0","0","09","","36.0896","","99","NA","NA","0.00","0.00","0.00"\n"95977","","Alys brn npgt prgrmg 11-19","0000000","NA","$67.05","NA","$73.11","1.000","1.000","1.000","A","0.73","NA","0.73","NA","0.73","","0.73","","0.73","0.40","1.86","1.86","1.86","1.86","0","ZZZ","0.00","0.00","0.00","3","1","0","0","0","09","","36.0896","","99","NA","NA","0.00","0.00","0.00"`
  };
  
  // Sample data for AB folder (payment rates)
  const abSampleData = `HCPCS Code,Short Descriptor,SI,APC,Relative Weight,Payment Rate,National Unadjusted Copayment,Minimum Unadjusted Copayment,"Note: Actual copayments would be lower due to the cap on copayments at the Inpatient Deductible of $1,600.00",Drug and Device Pass-Through Expiration during Calendar Year,* Indicates a Change
61885,Insrt/redo neurostim 1 array,J1,5465,151.2253,8200.26,1640.05,1640.05,,,
61888,Revise/remove neuroreceiver,J1,5432,31.7723,1723.05,344.61,344.61,,,
64568,Inc for vagus n elect impl,J1,5465,151.2253,8200.26,1640.05,1640.05,,,
64569,Revise/repl vagus n eltrd,J1,5463,105.0112,5692.66,1138.53,1138.53,,,
64570,Remove vagus n elect impl,Q2,5432,31.7723,1723.05,344.61,344.61,,,
95970,Alys npgt 1 brn npgt prgrmg,S,5734,0.7813,42.36,0.00,8.47,,,
95976,Alys smpl cn npgt prgrmg,S,5734,0.7813,42.36,0.00,8.47,,,
95977,Alys cplx cn npgt prgrmg,S,5734,0.7813,42.36,0.00,8.47,,,
95983,Alys brn npgt prgm 15 min,S,5734,0.7813,42.36,0.00,8.47,,,`;
  
  // Create directories and sample files
  directories.forEach(dir => {
    const dirPath = path.join(dataDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`Created directory: ${dirPath}`);
      
      // Create sample files based on directory type
      if (dir === 'AB') {
        // Create AB folder files
        const abYears = [
          { year: '2020', filename: '2020_january_web_addendum_b.12312019.csv' },
          { year: '2021', filename: '2021_January_Web_Addendum_B.12.29.20.csv' },
          { year: '2022', filename: 'January_2022_Web_Addendum_B.01.10.22.csv' },
          { year: '2023', filename: '2023_January_Web_Addendum_B.01202023a.csv' },
          { year: '2024', filename: 'January_Web_2024_Addendum_B.04.24.24.csv' },
          { year: '2025', filename: 'January 2025 Web Addendum B.12.31.24.csv' }
        ];
        
        abYears.forEach(({ year, filename }) => {
          const filePath = path.join(dirPath, filename);
          if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, abSampleData);
            console.log(`Created AB sample file: ${filePath}`);
          }
        });
      } else {
        // Create regular HCPCS code files
        const years = ['2020', '2021', '2022', '2023', '2024A', '2024B', '2025'];
        years.forEach(year => {
          let filePattern;
          if (dir === '618') {
            filePattern = `${year}-all-61885-61888-61889-61891-61892-national_payment_amount.csv`;
          } else if (dir === '645') {
            filePattern = `${year}-all-64568-64569-64570-national_payment_amount.csv`;
          } else { // 959
            filePattern = `${year}-all-95970-95976-95977-95983-national_payment_amount.csv`;
          }
          
          const filePath = path.join(dirPath, filePattern);
          if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, sampleDataByDir[dir]);
            console.log(`Created sample file: ${filePath}`);
          }
        });
      }
    }
  });
  
  // Create public directory and index.html if they don't exist
  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
    console.log(`Created directory: ${publicDir}`);
    
    // HTML content with links to new reports
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>HCPCS Code Data Viewer</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }
        h1, h2 {
          text-align: center;
        }
        .loader {
          border: 5px solid #f3f3f3;
          border-top: 5px solid #3498db;
          border-radius: 50%;
          width: 50px;
          height: 50px;
          animation: spin 2s linear infinite;
          margin: 20px auto;
          display: block;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th, td {
          border: 1px solid #ddd;
          padding: 8px;
          text-align: left;
        }
        th {
          background-color: #f2f2f2;
          position: sticky;
          top: 0;
        }
        tr:nth-child(even) {
          background-color: #f9f9f9;
        }
        .data-container {
          margin-top: 20px;
          overflow-x: auto;
          max-height: 600px;
          overflow-y: auto;
        }
        .years-nav, .dir-nav {
          display: flex;
          justify-content: center;
          gap: 10px;
          margin: 20px 0;
        }
        .year-btn, .dir-btn {
          padding: 8px 16px;
          background-color: #e0e0e0;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        .year-btn.active, .dir-btn.active {
          background-color: #3498db;
          color: white;
        }
        .codes-filter {
          margin: 20px 0;
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .search-input {
          padding: 8px;
          flex-grow: 1;
          max-width: 300px;
        }
        .controls-container {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
          justify-content: space-between;
          align-items: center;
        }
        .report-links {
          margin: 30px auto;
          text-align: center;
        }
        .report-link {
          display: inline-block;
          margin: 10px;
          padding: 10px 20px;
          background-color: #4CAF50;
          color: white;
          text-decoration: none;
          border-radius: 4px;
          transition: background-color 0.3s;
        }
        .report-link:hover {
          background-color: #45a049;
        }
      </style>
    </head>
    <body>
      <h1>HCPCS Code Data Viewer</h1>
      
      <div class="report-links">
        <h2>Analysis Reports</h2>
        <a href="/combined-report" target="_blank" class="report-link">Complete Payment & Reimbursement Analysis</a>
        <a href="/reimbursement-report" target="_blank" class="report-link">Reimbursement Analysis Only</a>
      </div>
      
      <div class="controls-container">
        <div class="dir-nav" id="dirNav"></div>
        <div class="codes-filter">
          <label for="codeSearch">Filter by HCPCS Code:</label>
          <input type="text" id="codeSearch" class="search-input" placeholder="Enter code...">
        </div>
      </div>
      
      <div class="years-nav" id="yearsNav"></div>
      
      <div id="loading" class="loader"></div>
      
      <div class="data-container">
        <table id="dataTable">
          <thead>
            <tr id="tableHeader"></tr>
          </thead>
          <tbody id="tableBody"></tbody>
        </table>
      </div>
      
      <script>
        document.addEventListener('DOMContentLoaded', () => {
          // Variables to store data
          let allData = {};
          let currentDirName = '618';
          let currentYearIndex = 0;
          const directories = ['618', '645', '959'];
          const years = ['2020', '2021', '2022', '2023', '2024A', '2024B', '2025'];
          
          // Elements
          const loadingEl = document.getElementById('loading');
          const dirNavEl = document.getElementById('dirNav');
          const yearsNavEl = document.getElementById('yearsNav');
          const tableHeaderEl = document.getElementById('tableHeader');
          const tableBodyEl = document.getElementById('tableBody');
          const codeSearchEl = document.getElementById('codeSearch');
          
          // Fetch data from the server
          async function fetchData() {
            try {
              loadingEl.style.display = 'block';
              const response = await fetch('/api/hcpcs-data');
              if (!response.ok) {
                throw new Error('Network response was not ok');
              }
              allData = await response.json();
              loadingEl.style.display = 'none';
              
              // Create directory navigation
              createDirectoryNavigation();
              
              // Create year navigation
              createYearNavigation();
              
              // Display data for the first directory and year by default
              displayYearData(currentDirName, currentYearIndex);
            } catch (error) {
              console.error('Error fetching data:', error);
              loadingEl.style.display = 'none';
              alert('Failed to load HCPCS data. Please check the console for details.');
            }
          }
          
          // Create buttons for directory navigation
          function createDirectoryNavigation() {
            directories.forEach((dir) => {
              const btn = document.createElement('button');
              btn.textContent = 'HCPCS ' + dir;
              btn.className = 'dir-btn';
              if (dir === currentDirName) btn.classList.add('active');
              
              btn.addEventListener('click', () => {
                // Update active class
                document.querySelectorAll('.dir-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Update current directory
                currentDirName = dir;
                
                // Display data for selected directory and year
                displayYearData(currentDirName, currentYearIndex);
              });
              
              dirNavEl.appendChild(btn);
            });
          }
          
          // Create buttons for year navigation
          function createYearNavigation() {
            years.forEach((year, index) => {
              const btn = document.createElement('button');
              btn.textContent = year;
              btn.className = 'year-btn';
              if (index === 0) btn.classList.add('active');
              
              btn.addEventListener('click', () => {
                // Update active class
                document.querySelectorAll('.year-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Update current year index
                currentYearIndex = index;
                
                // Display data for selected directory and year
                displayYearData(currentDirName, currentYearIndex);
              });
              
              yearsNavEl.appendChild(btn);
            });
          }
          
          // Display data for a specific directory and year
          function displayYearData(dirName, yearIndex) {
            // Check if data exists for this directory
            if (!allData[dirName] || !allData[dirName][yearIndex]) {
              tableHeaderEl.innerHTML = '';
              tableBodyEl.innerHTML = '<tr><td colspan="5">No data available for this selection</td></tr>';
              return;
            }
            
            const yearData = allData[dirName][yearIndex];
            
            // Clear previous data
            tableHeaderEl.innerHTML = '';
            tableBodyEl.innerHTML = '';
            
            if (yearData.length === 0) {
              tableBodyEl.innerHTML = '<tr><td colspan="5">No data available for this selection</td></tr>';
              return;
            }
            
            // Create table header
            const headers = Object.keys(yearData[0]);
            headers.forEach(header => {
              const th = document.createElement('th');
              th.textContent = header;
              tableHeaderEl.appendChild(th);
            });
            
            // Apply current filter
            filterAndDisplayData();
          }
          
          // Filter and display data based on search input
          function filterAndDisplayData() {
            const searchTerm = codeSearchEl.value.trim().toUpperCase();
            
            // Check if data exists for current selection
            if (!allData[currentDirName] || !allData[currentDirName][currentYearIndex]) {
  tableBodyEl.innerHTML = '<tr><td colspan="5">No data available for this selection</td></tr>';
  return;
}

const yearData = allData[currentDirName][currentYearIndex];

// Clear previous data
tableBodyEl.innerHTML = '';

if (yearData.length === 0) {
  tableBodyEl.innerHTML = '<tr><td colspan="5">No data available for this selection</td></tr>';
  return;
}

// Filter data
const filteredData = searchTerm ? 
  yearData.filter(item => {
    const code = item['HCPCS Code'] || '';
    return code.toUpperCase().includes(searchTerm);
  }) : 
  yearData;

// Create table rows
filteredData.forEach(item => {
  const row = document.createElement('tr');
  
  Object.values(item).forEach(value => {
    const td = document.createElement('td');
    td.textContent = value;
    row.appendChild(td);
  });
  
  tableBodyEl.appendChild(row);
});

if (filteredData.length === 0) {
  tableBodyEl.innerHTML = '<tr><td colspan="5">No matching codes found</td></tr>';
}
}

// Add event listener for search input
codeSearchEl.addEventListener('input', filterAndDisplayData);

// Start fetching data
fetchData();
});
</script>
</body>
</html>
`;
  }
}


// Set up environment before starting the server
setupEnvironment();

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`- Access web interface: http://localhost:${PORT}`);
  console.log(`- Available endpoints:`);
  console.log(`  * All data: http://localhost:${PORT}/api/hcpcs-data`);
  console.log(`  * 618 codes: http://localhost:${PORT}/api/hcpcs-data/618`);
  console.log(`  * 645 codes: http://localhost:${PORT}/api/hcpcs-data/645`);
  console.log(`  * 959 codes: http://localhost:${PORT}/api/hcpcs-data/959`);
});