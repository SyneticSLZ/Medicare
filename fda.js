const express = require('express');
const axios = require('axios');
const winston = require('winston');
const fs = require('fs').promises;
const { createWriteStream } = require('fs');
const path = require('path');

// Logging setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'server.log' })
  ]
});

// Retry utility
async function retryRequest(fn, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      logger.warn(`Retry ${i + 1}/${retries} failed: ${error.message}. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Fetch ClinicalTrials.gov data
async function fetchClinicalTrials(competitor) {
  const baseUrl = 'https://clinicaltrials.gov/api/v2/studies?query.cond=epilepsy&query.sponsor="SK Life Science"&pageSize=100';
  let allStudies = [];
  let nextPageToken = null;
  const maxPages = 10;

  for (let pageCount = 0; pageCount < maxPages && (nextPageToken !== null || pageCount === 0); pageCount++) {
    const url = nextPageToken ? `${baseUrl}&pageToken=${nextPageToken}` : baseUrl;
    try {
      logger.info(`Fetching ClinicalTrials.gov data for ${competitor}: ${url}`);
      const response = await axios.get(url, { timeout: 15000 });
      const data = response.data;

      logger.info(`Raw ClinicalTrials.gov response: ${JSON.stringify(data).slice(0, 200)}...`);
      if (data.studies && Array.isArray(data.studies)) {
        logger.info(`Found ${data.studies.length} studies on page ${pageCount + 1}`);
        allStudies = [...allStudies, ...data.studies];
        nextPageToken = data.nextPageToken || null;
      } else {
        break;
      }
    } catch (error) {
      logger.error(`ClinicalTrials.gov error: ${error.message} (Status: ${error.response?.status || 'unknown'})`);
      return { status: "error", error: error.message, statusCode: error.response?.status || "unknown", data: [] };
    }
  }

  return {
    status: allStudies.length > 0 ? "success" : "empty",
    count: allStudies.length,
    data: allStudies,
    message: allStudies.length === 0 ? "No clinical trials found for SK Life Science" : undefined
  };
}

// Fetch FDA data
async function fetchAllFdaData(url, competitor, endpointName) {
  let allResults = [];
  let skip = 0;
  const limit = 100;
  const maxSkip = 1000;

  while (skip < maxSkip) {
    const paginatedUrl = `${url}&limit=${limit}&skip=${skip}`;
    try {
      logger.info(`Fetching FDA data for ${endpointName}: ${paginatedUrl}`);
      const response = await axios.get(paginatedUrl, { timeout: 15000 });
      const data = response.data;

      logger.info(`Raw FDA response from ${endpointName}: ${JSON.stringify(data).slice(0, 200)}...`);
      if (data.results && Array.isArray(data.results)) {
        logger.info(`Found ${data.results.length} results from ${endpointName} at skip=${skip}`);
        const filteredResults = data.results.filter(result => {
          const text = JSON.stringify(result).toLowerCase();
          return text.includes('epilepsy') || text.includes('seizure') || text.includes('convulsion');
        });
        allResults = [...allResults, ...filteredResults];
        skip += limit;
        if (data.results.length < limit) break;
      } else {
        break;
      }
    } catch (error) {
      logger.error(`FDA ${endpointName} error: ${error.message} (Status: ${error.response?.status || 'unknown'})`);
      return { status: "error", error: error.message, statusCode: error.response?.status || "unknown", data: [] };
    }
  }

  return {
    status: allResults.length > 0 ? "success" : "empty",
    count: allResults.length,
    data: allResults,
    message: allResults.length === 0 ? `No epilepsy-related results from ${endpointName}` : undefined
  };
}

// Fetch FDA data for XCOPRI
async function fetchFdaData(competitor) {
  return retryRequest(async () => {
    let results = { endpointCount: 0, endpoints: {}, combinedResults: [] };

    const competitorEndpoints = {
      "XCOPRI": {
        type: "drug",
        drugs: 'https://api.fda.gov/drug/ndc.json?search=openfda.brand_name:"XCOPRI" openfda.generic_name:"cenobamate"',
        application: 'https://api.fda.gov/drug/drugsfda.json?search=sponsor_name:"SK Life Science"',
        adverse: 'https://api.fda.gov/drug/event.json?search=openfda.brand_name:"XCOPRI" openfda.generic_name:"cenobamate"',
        label: 'https://api.fda.gov/drug/label.json?search=openfda.brand_name:"XCOPRI" openfda.generic_name:"cenobamate"',
        enforcement: 'https://api.fda.gov/drug/enforcement.json?search=brand_name:"XCOPRI" generic_name:"cenobamate"'
      }
    };

    const competitorData = competitorEndpoints[competitor];
    if (!competitorData) throw new Error(`No endpoints defined for ${competitor}`);

    const endpoints = competitorData;
    results.endpointCount = Object.keys(endpoints).filter(key => key !== 'type').length;

    for (const [endpointName, url] of Object.entries(endpoints)) {
      if (endpointName === 'type') continue;

      const endpointResult = await fetchAllFdaData(url, competitor, endpointName);
      results.endpoints[endpointName] = endpointResult;
      if (endpointResult.status === "success") {
        const processedResults = processEndpointResults(endpointName, endpointResult.data, competitor, "drug");
        results.combinedResults = [...results.combinedResults, ...processedResults];
      }
    }

    const clinicalTrialsResult = await fetchClinicalTrials(competitor);
    results.endpoints["clinicaltrials"] = clinicalTrialsResult;
    if (clinicalTrialsResult.status === "success") {
      const processedResults = processEndpointResults("clinicaltrials", clinicalTrialsResult.data, competitor, "drug");
      results.combinedResults = [...results.combinedResults, ...processedResults];
    }

    if (results.combinedResults.length === 0) {
      results.combinedResults = [{ source: "placeholder", name: competitor, description: `No epilepsy-related data found for ${competitor}`, date: "Unknown", status: "Unknown" }];
    }

    return results;
  }, 3, 2000);
}

// Process endpoint results
function processEndpointResults(endpointName, results, searchTerm, type) {
  return results.map(result => {
    let processed = { source: endpointName, name: searchTerm };
    switch (endpointName) {
      case "drugs":
        processed.description = `${result.openfda?.brand_name?.[0] || result.openfda?.generic_name?.[0] || "Unknown drug"} (Epilepsy-related)`;
        processed.date = result.start_marketing_date || "Unknown";
        processed.status = result.status || "Unknown";
        break;
      case "application":
        processed.description = `${result.products?.[0]?.brand_name || "Unknown application"} (Epilepsy treatment)`;
        processed.date = result.submissions?.[0]?.submission_date || "Unknown";
        processed.status = result.submissions?.[0]?.submission_status || "Unknown";
        break;
      case "adverse":
        processed.description = `${result.patient?.drug?.[0]?.medicinalproduct || "Adverse event"} (Epilepsy-related)`;
        processed.date = result.receivedate || "Unknown";
        processed.status = "Reported";
        break;
      case "label":
        processed.description = `${result.openfda?.brand_name?.[0] || "Label info"} (Epilepsy indication)`;
        processed.date = result.effective_time || "Unknown";
        processed.status = "Active";
        break;
      case "enforcement":
        processed.description = `${result.product_description || "Enforcement action"} (Epilepsy drug-related)`;
        processed.date = result.report_date || "Unknown";
        processed.status = result.status || "Unknown";
        break;
      case "clinicaltrials":
        processed.description = `${result.protocolSection?.identificationModule?.briefTitle || "Clinical trial"} (Epilepsy study)`;
        processed.date = result.protocolSection?.statusModule?.startDateStruct?.date || "Unknown";
        processed.status = result.protocolSection?.statusModule?.overallStatus || "Unknown";
        break;
    }
    return processed;
  });
}

// Express setup
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
app.use(express.json());
const competitors = ["XCOPRI"];

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    logger.info(`Data directory ensured at ${DATA_DIR}`);
  } catch (error) {
    logger.error(`Failed to create data directory: ${error.message}`);
    throw error;
  }
}

async function saveEndpointData(competitor, endpointName, data) {
  const competitorDir = path.join(DATA_DIR, competitor.replace(/\s+/g, '_'));
  const filePath = path.join(competitorDir, `${endpointName}.json`);
  try {
    await fs.mkdir(competitorDir, { recursive: true });
    const stream = createWriteStream(filePath);
    stream.write(JSON.stringify(data, null, 2));
    stream.end();
    logger.info(`Saved ${endpointName} data for ${competitor} to ${filePath}`);
  } catch (error) {
    logger.error(`Failed to save ${endpointName} data for ${competitor}: ${error.message}`);
    throw error;
  }
}

app.get('/api/fda-data', async (req, res) => {
  try {
    logger.info('Starting epilepsy-related FDA data fetch for XCOPRI');
    const startTime = Date.now();
    await ensureDataDir();

    const fetchPromises = competitors.map(async (competitor) => {
      try {
        const data = await fetchFdaData(competitor);
        const savePromises = Object.entries(data.endpoints).map(([endpointName, endpointData]) =>
          saveEndpointData(competitor, endpointName, endpointData)
        );
        await Promise.all(savePromises);
        await saveEndpointData(competitor, 'combinedResults', data.combinedResults);
        return { competitor, data };
      } catch (error) {
        logger.error(`Failed to fetch/save data for ${competitor}: ${error.message}`);
        const errorData = {
          endpointCount: 0,
          endpoints: {},
          combinedResults: [{ source: "error", name: competitor, description: error.message, date: "Unknown", status: "Error" }]
        };
        await saveEndpointData(competitor, 'combinedResults', errorData.combinedResults);
        return { competitor, data: errorData };
      }
    });

    const allResults = await Promise.all(fetchPromises);
    const responseData = Object.fromEntries(allResults.map(({ competitor, data }) => [competitor, data]));
    const duration = (Date.now() - startTime) / 1000;
    logger.info(`Completed data fetch for XCOPRI in ${duration}s`);

    res.status(200).json({ status: "success", data: responseData, timestamp: new Date().toISOString(), duration: `${duration}s` });
  } catch (error) {
    logger.error(`Server error: ${error.message}`);
    res.status(500).json({ status: "error", message: "Internal server error", error: error.message });
  }
});

app.get('/api/fda-data/:competitor', async (req, res) => {
  const { competitor } = req.params;
  if (competitor !== "XCOPRI") {
    return res.status(404).json({ status: "error", message: `This endpoint only supports XCOPRI` });
  }

  try {
    logger.info(`Fetching epilepsy-related FDA data for ${competitor}`);
    const data = await fetchFdaData(competitor);
    res.status(200).json({ status: "success", competitor, data, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error(`Failed to fetch data for ${competitor}: ${error.message}`);
    res.status(500).json({ status: "error", message: `Failed to fetch data for ${competitor}`, error: error.message });
  }
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} - Configured for XCOPRI epilepsy data`);
});