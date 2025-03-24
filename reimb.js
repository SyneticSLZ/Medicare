/**
 * HCPCS Reimbursement Calculator
 * 
 * This module calculates Medicare reimbursement rates for HCPCS codes using the formula:
 * [(Work RVU × Work GPCI) + (PE RVU × PE GPCI) + (MP RVU × MP GPCI)] × Conversion Factor
 * 
 * It also calculates year-over-year percentage changes in reimbursement rates.
 */

// Import required modules
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

/**
 * Calculate reimbursement rate based on the Medicare formula
 * 
 * @param {Object} codeData - HCPCS code data with RVU values
 * @param {String} facilityType - 'facility' or 'non-facility'
 * @return {Number} - Calculated reimbursement rate
 */
function calculateReimbursementRate(codeData, facilityType = 'facility') {
  // Get the appropriate PE RVU based on facility type
  let peRVU;
  if (facilityType === 'facility') {
    peRVU = parseFloat(codeData['Fully Implemented Facility PE RVU'] || 0);
    // If not available, try the transitioned value
    if (isNaN(peRVU) || peRVU === 0) {
      peRVU = parseFloat(codeData['Transitioned Facility PE RVU'] || 0);
    }
  } else {
    // Non-facility
    peRVU = parseFloat(codeData['Fully Implemented Non-FAC PE RVU'] || 0);
    // If not available, try the transitioned value
    if (isNaN(peRVU) || peRVU === 0) {
      peRVU = parseFloat(codeData['Transitioned Non-FAC PE RVU'] || 0);
    }
  }

  // Get other required values
  const workRVU = parseFloat(codeData['Work RVU'] || 0);
  const mpRVU = parseFloat(codeData['MP RVU'] || 0);
  const workGPCI = parseFloat(codeData['GPCI Work'] || 1.0);
  const peGPCI = parseFloat(codeData['GPCI PE'] || 1.0);
  const mpGPCI = parseFloat(codeData['GPCI MP'] || 1.0);
  const conversionFactor = parseFloat(codeData['Conv Fact'] || 0);

  // Calculate using the formula: [(Work RVU × Work GPCI) + (PE RVU × PE GPCI) + (MP RVU × MP GPCI)] × Conversion Factor
  const reimbursement = ((workRVU * workGPCI) + (peRVU * peGPCI) + (mpRVU * mpGPCI)) * conversionFactor;
  
  // Ensure we return 0 for NaN results
  return isNaN(reimbursement) ? 0 : parseFloat(reimbursement.toFixed(2));
}

/**
 * Calculate percentage change between two values
 * 
 * @param {Number} oldValue - Previous value
 * @param {Number} newValue - Current value
 * @return {Number} - Percentage change (rounded to 2 decimal places)
 */
function calculatePercentageChange(oldValue, newValue) {
  if (oldValue === 0) return 0; // Avoid division by zero
  const percentChange = ((newValue - oldValue) / oldValue) * 100;
  return parseFloat(percentChange.toFixed(2));
}

/**
 * Process all files and calculate reimbursement rates and changes
 * 
 * @param {Object} options - Configuration options
 * @return {Promise<Object>} - Object containing all calculated data
 */
async function calculateAllReimbursements(options = {}) {
  const { 
    dataDir = path.join(__dirname, 'data'),
    directories = ['618', '645', '959'],
    years = ['2020', '2021', '2022', '2023', '2024A', '2024B', '2025'],
    facilityType = 'facility' // 'facility' or 'non-facility'
  } = options;

  // Results object to store all calculated data
  const results = {};
  
  // Process each directory
  for (const dir of directories) {
    console.log(`Processing directory: ${dir}`);
    results[dir] = {};
    
    // Process codes for each year
    const yearlyData = [];
    const yearlyRates = {};
    
    for (const year of years) {
      console.log(`Processing year: ${year} in directory: ${dir}`);
      
      // File pattern based on directory
      const filePattern = getFilePattern(dir, year);
      const filePath = path.join(dataDir, dir, filePattern);
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        yearlyData.push([]);
        continue;
      }
      
      // Read and parse the CSV file
      const codeData = await readCSVFile(filePath);
      yearlyData.push(codeData);
      
      // Calculate reimbursement rates for all codes in this year
      const rates = {};
      for (const code of codeData) {
        const hcpcsCode = code['HCPCS Code'];
        if (hcpcsCode && hcpcsCode !== 'HCPCS Code') {
          const rate = calculateReimbursementRate(code, facilityType);
          rates[hcpcsCode] = rate;
        }
      }
      
      yearlyRates[year] = rates;
    }
    
    // Store the yearly data and rates
    results[dir].data = yearlyData;
    results[dir].rates = yearlyRates;
    
    // Calculate percentage changes between consecutive years
    results[dir].changes = calculateYearlyChanges(yearlyRates, years);
  }
  
  return results;
}

/**
 * Calculate percentage changes in reimbursement rates between consecutive years
 * 
 * @param {Object} yearlyRates - Object containing rates by year and code
 * @param {Array<String>} years - Array of years in chronological order
 * @return {Object} - Object containing percentage changes
 */
function calculateYearlyChanges(yearlyRates, years) {
  const changes = {};
  
  // Get all unique HCPCS codes across all years
  const allCodes = new Set();
  for (const year in yearlyRates) {
    Object.keys(yearlyRates[year]).forEach(code => allCodes.add(code));
  }
  
  // Calculate changes for each code
  for (const code of allCodes) {
    changes[code] = {};
    
    for (let i = 1; i < years.length; i++) {
      const prevYear = years[i-1];
      const currYear = years[i];
      
      // Get rates for both years
      const prevRate = yearlyRates[prevYear]?.[code] || 0;
      const currRate = yearlyRates[currYear]?.[code] || 0;
      
      // Calculate percentage change
      const change = calculatePercentageChange(prevRate, currRate);
      changes[code][`${prevYear} to ${currYear}`] = change;
    }
  }
  
  return changes;
}

/**
 * Generate the appropriate file pattern based on directory and year
 * 
 * @param {String} dir - Directory name (618, 645, or 959)
 * @param {String} year - Year (e.g., 2020, 2021, etc.)
 * @return {String} - File pattern
 */
function getFilePattern(dir, year) {
  if (dir === '618') {
    return `${year}-all-61885-61888-61889-61891-61892-national_payment_amount.csv`;
  } else if (dir === '645') {
    return `${year}-all-64568-64569-64570-national_payment_amount.csv`;
  } else { // 959
    return `${year}-all-95970-95976-95977-95983-national_payment_amount.csv`;
  }
}

/**
 * Read and parse a CSV file
 * 
 * @param {String} filePath - Path to the CSV file
 * @return {Promise<Array>} - Array of parsed CSV data
 */
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
              
              // Convert currency strings to numbers
              if (value.startsWith('$')) {
                value = parseFloat(value.substring(1).replace(/,/g, ''));
              }
            }
            
            cleanedRow[cleanKey] = value;
          });
          return cleanedRow;
        });
        
        resolve(processedData);
      } catch (error) {
        console.error(`Error parsing CSV ${filePath}:`, error);
        reject(error);
      }
    });
  });
}

/**
 * Generate a summary report with reimbursement rates and year-over-year changes
 * 
 * @param {Object} results - Calculated reimbursement data
 * @param {String} format - Output format ('console', 'json', or 'html')
 * @return {String|Object} - Formatted report or data object
 */
function generateReport(results, format = 'console') {
  if (format === 'json') {
    return results;
  }
  
  let report = '';
  
  if (format === 'html') {
    report = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>HCPCS Reimbursement Analysis</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1, h2, h3 { color: #333; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: right; }
        th { background-color: #f2f2f2; text-align: center; }
        tr:nth-child(even) { background-color: #f9f9f9; }
        .code-cell { text-align: left; font-weight: bold; }
        .positive-change { color: green; }
        .negative-change { color: red; }
        .section { margin-bottom: 30px; }
      </style>
    </head>
    <body>
      <h1>HCPCS Reimbursement Analysis</h1>
    `;
  }
  
  // Process each directory
  for (const dir in results) {
    const dirData = results[dir];
    
    if (format === 'console') {
      report += `\n================================\n`;
      report += `HCPCS Codes in Group ${dir}\n`;
      report += `================================\n\n`;
    } else if (format === 'html') {
      report += `<div class="section"><h2>HCPCS Codes in Group ${dir}</h2>`;
    }
    
    // Get all years that have data
    const years = Object.keys(dirData.rates);
    
    // Get all codes that have data
    const codes = new Set();
    for (const year in dirData.rates) {
      Object.keys(dirData.rates[year]).forEach(code => codes.add(code));
    }
    
    // Sort codes
    const sortedCodes = [...codes].sort();
    
    // Create reimbursement rates table
    if (format === 'console') {
      // Header row
      report += `Reimbursement Rates (in dollars)\n`;
      report += `Code      | ${years.join(' | ')} \n`;
      report += `-`.repeat(12 + years.length * 10) + `\n`;
      
      // Data rows
      for (const code of sortedCodes) {
        report += `${code.padEnd(10)} |`;
        for (const year of years) {
          const rate = dirData.rates[year][code] || 'N/A';
          report += ` ${(rate + '').padEnd(7)} |`;
        }
        report += `\n`;
      }
      
      report += `\nPercentage Changes Year-over-Year\n`;
      
      // Change periods
      const periods = [];
      for (let i = 1; i < years.length; i++) {
        periods.push(`${years[i-1]} to ${years[i]}`);
      }
      
      // Header row for changes
      report += `Code      | ${periods.join(' | ')} \n`;
      report += `-`.repeat(12 + periods.length * 12) + `\n`;
      
      // Data rows for changes
      for (const code of sortedCodes) {
        report += `${code.padEnd(10)} |`;
        for (const period of periods) {
          const change = dirData.changes[code][period];
          const changeStr = change !== undefined ? (change >= 0 ? '+' : '') + change + '%' : 'N/A';
          report += ` ${changeStr.padEnd(9)} |`;
        }
        report += `\n`;
      }
    } else if (format === 'html') {
      // Reimbursement rates table
      report += `
        <h3>Reimbursement Rates (in dollars)</h3>
        <table>
          <thead>
            <tr>
              <th>HCPCS Code</th>
              ${years.map(year => `<th>${year}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
      `;
      
      for (const code of sortedCodes) {
        report += `<tr><td class="code-cell">${code}</td>`;
        for (const year of years) {
          const rate = dirData.rates[year][code] || 'N/A';
          report += `<td>${rate}</td>`;
        }
        report += `</tr>`;
      }
      
      report += `
          </tbody>
        </table>
        
        <h3>Percentage Changes Year-over-Year</h3>
        <table>
          <thead>
            <tr>
              <th>HCPCS Code</th>
      `;
      
      // Change periods
      const periods = [];
      for (let i = 1; i < years.length; i++) {
        const period = `${years[i-1]} to ${years[i]}`;
        periods.push(period);
        report += `<th>${period}</th>`;
      }
      
      report += `
            </tr>
          </thead>
          <tbody>
      `;
      
      for (const code of sortedCodes) {
        report += `<tr><td class="code-cell">${code}</td>`;
        for (const period of periods) {
          const change = dirData.changes[code][period];
          if (change !== undefined) {
            const cssClass = change >= 0 ? 'positive-change' : 'negative-change';
            const sign = change >= 0 ? '+' : '';
            report += `<td class="${cssClass}">${sign}${change}%</td>`;
          } else {
            report += `<td>N/A</td>`;
          }
        }
        report += `</tr>`;
      }
      
      report += `
          </tbody>
        </table>
      </div>`;
    }
  }
  
  if (format === 'html') {
    report += `
    </body>
    </html>`;
  }
  
  return report;
}

// Export the functions
module.exports = {
  calculateReimbursementRate,
  calculatePercentageChange,
  calculateAllReimbursements,
  generateReport
};