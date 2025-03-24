const express = require('express');
const axios = require('axios');

const app = express();
const port = 3000;

// HCPCS codes
const hcpcsCodes = ['61885', '61888', '61889', '61891', '61892', '64568', '64569', '64570', '95970', '95976', '95977', '95983'];

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
    record.providers.push({
      npi: entry.Rndrng_NPI,
      name: `${entry.Rndrng_Prvdr_First_Name} ${entry.Rndrng_Prvdr_Last_Org_Name}`,
      state: entry.Rndrng_Prvdr_State_Abrvtn,
      specialty: providerInfo.Rndrng_Prvdr_Type || 'Unknown',
      totalProviderServices: providerInfo.Tot_Srvcs || 0,
      totalProviderSpending: providerInfo.Tot_Mdcr_Pymt_Amt || 0,
      beneAvgAge: providerInfo.Bene_Avg_Age || 0,
      beneConditions: {
        parkinsons: providerInfo.Bene_CC_PH_Parkinson_V2_Pct || 0,
        depression: providerInfo.Bene_CC_BH_Depress_V1_Pct || 0,
      },
      services,
      spending: payment,
    });

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

  Object.keys(analysis).forEach(hcpcs => {
    const shares = companyMapping[hcpcs] || {};
    analysis[hcpcs].marketShare = Object.keys(shares).map(company => ({
      company,
      share: shares[company],
      estimatedSpending: analysis[hcpcs].marketSize * shares[company],
    }));
  });

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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});