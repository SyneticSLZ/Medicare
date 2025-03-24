const express = require('express');
const axios = require('axios');
const winston = require('winston');
const fs = require('fs').promises;
const path = require('path');

// Set up logging
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

// Simple retryRequest utility
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

// FDA data fetching function
async function fetchFdaData(competitor) {
  return retryRequest(async () => {
    let results = { 
      endpoints: {}, 
      combinedResults: []
    };

    const competitorEndpoints = {
      "LivaNova": {
        type: "device",
        registration: encodeURI('https://api.fda.gov/device/registrationlisting.json?search=registration.owner_operator.legal_name:"LivaNova"+AND+(k_number:K173068+OR+k_number:K161599+OR+k_number:K152601)&limit=100'),
        k510: encodeURI('https://api.fda.gov/device/510k.json?search=applicant:"LivaNova"+AND+product_code:LYC+AND+advisory_committee:"neurology"+AND+decision_summary:seizure&limit=100&sort=decision_date:desc'),
        enforcement: encodeURI('https://api.fda.gov/device/enforcement.json?search=product_code:LYC+AND+firm_name:"LivaNova"'),
        adverse: encodeURI('https://api.fda.gov/device/event.json?search=device.device_report_product_code:LYC+AND+manufacturer_d_name:"LivaNova"&limit=100'),
        udi: encodeURI('https://api.fda.gov/device/udi.json?search=product_code:LYC+AND+company_name:"LivaNova"&limit=100'),
        pma: encodeURI('https://api.fda.gov/device/pma.json?search=product_code:LYC+AND+applicant:"LivaNova"&limit=100')
      },
      "Medtronic": {
        type: "device",
        registration: encodeURI('https://api.fda.gov/device/registrationlisting.json?search=registration.owner_operator.legal_name:"Medtronic"+AND+(product_code:LYC+OR+product_code:MHY)&limit=100'),
        k510: encodeURI('https://api.fda.gov/device/510k.json?search=applicant:"Medtronic"+AND+(product_code:LYC+OR+product_code:MHY)+AND+advisory_committee:"neurology"+AND+decision_summary:seizure&limit=100&sort=decision_date:desc'),
        enforcement: encodeURI('https://api.fda.gov/device/enforcement.json?search=product_code:(LYC+MHY)+AND+firm_name:"Medtronic"'),
        adverse: encodeURI('https://api.fda.gov/device/event.json?search=device.device_report_product_code:(LYC+MHY)+AND+manufacturer_d_name:"Medtronic"&limit=100'),
        udi: encodeURI('https://api.fda.gov/device/udi.json?search=product_code:(LYC+MHY)+AND+company_name:"Medtronic"&limit=100'),
        pma: encodeURI('https://api.fda.gov/device/pma.json?search=product_code:(LYC+MHY)+AND+applicant:"Medtronic"&limit=100')
      },
      "NeuroPace": {
        type: "device",
        registration: encodeURI('https://api.fda.gov/device/registrationlisting.json?search=registration.owner_operator.legal_name:"NeuroPace"+AND+product_code:MHY&limit=100'),
        k510: encodeURI('https://api.fda.gov/device/510k.json?search=applicant:"NeuroPace"+AND+product_code:MHY+AND+advisory_committee:"neurology"+AND+decision_summary:seizure&limit=100&sort=decision_date:desc'),
        enforcement: encodeURI('https://api.fda.gov/device/enforcement.json?search=product_code:MHY+AND+firm_name:"NeuroPace"'),
        adverse: encodeURI('https://api.fda.gov/device/event.json?search=device.device_report_product_code:MHY+AND+manufacturer_d_name:"NeuroPace"&limit=100'),
        udi: encodeURI('https://api.fda.gov/device/udi.json?search=product_code:MHY+AND+company_name:"NeuroPace"&limit=100'),
        pma: encodeURI('https://api.fda.gov/device/pma.json?search=product_code:MHY+AND+applicant:"NeuroPace"&limit=100')
      },
      "XCOPRI": {
        type: "drug",
        drugs: encodeURI('https://api.fda.gov/drug/ndc.json?search=manufacturer_name:"SK+Biopharmaceuticals"+AND+brand_name:"XCOPRI"&limit=100'),
        application: encodeURI('https://api.fda.gov/drug/application.json?search=applicant:"SK+Biopharmaceuticals"+AND+product_name:"Cenobamate"&limit=100'),
        adverse: encodeURI('https://api.fda.gov/drug/event.json?search=manufacturer_name:"SK+Biopharmaceuticals"+AND+brand_name:"XCOPRI"&limit=100')
      },
      "Precisis AG": {
        type: "device",
        registration: encodeURI('https://api.fda.gov/device/registrationlisting.json?search=registration.owner_operator.legal_name:"Precisis"&limit=100'),
        k510: encodeURI('https://api.fda.gov/device/510k.json?search=applicant:"Precisis"+AND+advisory_committee:"neurology"+AND+decision_summary:seizure&limit=100&sort=decision_date:desc'),
        enforcement: encodeURI('https://api.fda.gov/device/enforcement.json?search=firm_name:"Precisis"'),
        adverse: encodeURI('https://api.fda.gov/device/event.json?search=manufacturer_d_name:"Precisis"&limit=100'),
        udi: encodeURI('https://api.fda.gov/device/udi.json?search=company_name:"Precisis"&limit=100'),
        pma: encodeURI('https://api.fda.gov/device/pma.json?search=applicant:"Precisis"&limit=100')
      },
      "Epi-Minder": {
        type: "device",
        registration: encodeURI('https://api.fda.gov/device/registrationlisting.json?search=registration.owner_operator.legal_name:"Epi-Minder"&limit=100'),
        k510: encodeURI('https://api.fda.gov/device/510k.json?search=applicant:"Epi-Minder"+AND+advisory_committee:"neurology"+AND+decision_summary:seizure&limit=100&sort=decision_date:desc'),
        enforcement: encodeURI('https://api.fda.gov/device/enforcement.json?search=firm_name:"Epi-Minder"'),
        adverse: encodeURI('https://api.fda.gov/device/event.json?search=manufacturer_d_name:"Epi-Minder"&limit=100'),
        udi: encodeURI('https://api.fda.gov/device/udi.json?search=company_name:"Epi-Minder"&limit=100'),
        pma: encodeURI('https://api.fda.gov/device/pma.json?search=applicant:"Epi-Minder"&limit=100')
      },
      "Flow Medical": {
        type: "device",
        registration: encodeURI('https://api.fda.gov/device/registrationlisting.json?search=registration.owner_operator.legal_name:"Flow+Medical"&limit=100'),
        k510: encodeURI('https://api.fda.gov/device/510k.json?search=applicant:"Flow+Medical"+AND+advisory_committee:"neurology"+AND+decision_summary:seizure&limit=100&sort=decision_date:desc'),
        enforcement: encodeURI('https://api.fda.gov/device/enforcement.json?search=firm_name:"Flow+Medical"'),
        adverse: encodeURI('https://api.fda.gov/device/event.json?search=manufacturer_d_name:"Flow+Medical"&limit=100'),
        udi: encodeURI('https://api.fda.gov/device/udi.json?search=company_name:"Flow+Medical"&limit=100'),
        pma: encodeURI('https://api.fda.gov/device/pma.json?search=applicant:"Flow+Medical"&limit=100')
      }
    };

    const competitorData = competitorEndpoints[competitor];
    if (!competitorData) {
      throw new Error(`No endpoints defined for competitor: ${competitor}`);
    }

    const endpoints = competitorData;
    const type = competitorData.type;

    for (const [endpointName, url] of Object.entries(endpoints)) {
      if (endpointName === "type") continue;

      try {
        logger.info(`Fetching FDA data from ${endpointName} for ${competitor}: ${url}`);
        const response = await axios.get(url, { timeout: 15000 });

        if (response.data && response.data.results && Array.isArray(response.data.results)) {
          results.endpoints[endpointName] = {
            status: "success",
            count: response.data.results.length,
            data: response.data.results
          };

          const processedResults = processEndpointResults(endpointName, response.data.results, competitor, type);
          results.combinedResults = [...results.combinedResults, ...processedResults];
        } else {
          results.endpoints[endpointName] = {
            status: "empty",
            count: 0,
            data: []
          };
        }
      } catch (error) {
        logger.error(`FDA ${endpointName} API error for ${competitor}: ${error.message}`);
        results.endpoints[endpointName] = {
          status: "error",
          error: error.message,
          statusCode: error.response?.status || "unknown",
          data: []
        };
      }
    }

    if (results.combinedResults.length === 0) {
      results.combinedResults = [{
        source: "placeholder",
        name: competitor,
        description: `No FDA data found for ${competitor} across all endpoints`,
        date: "Unknown",
        status: "Unknown"
      }];
    }

    return results;
  }, 3, 2000);
}

function processEndpointResults(endpointName, results, searchTerm, type) {
  return results.map(result => {
    let processed = { source: endpointName, name: searchTerm };
    if (type === "drug") {
      switch (endpointName) {
        case "drugs":
          processed.description = result.brand_name || result.generic_name || "Unknown drug";
          processed.date = result.start_marketing_date || "Unknown";
          processed.status = result.status || "Unknown";
          break;
        case "application":
          processed.description = result.products?.[0]?.brand_name || "Unknown application";
          processed.date = result.action_date || "Unknown";
          processed.status = result.application_status || "Unknown";
          break;
        case "adverse":
          processed.description = result.patient?.drug?.[0]?.medicinalproduct || "Adverse event";
          processed.date = result.receivedate || "Unknown";
          processed.status = "Reported";
          break;
      }
    } else {
      switch (endpointName) {
        case "registration":
          processed.description = result.listing?.device?.device_name || "Registered device";
          processed.date = result.registration?.created_date || "Unknown";
          processed.status = result.registration?.status || "Unknown";
          break;
        case "k510":
          processed.description = result.device_name || "510(k) submission";
          processed.date = result.decision_date || "Unknown";
          processed.status = result.decision || "Unknown";
          break;
        case "enforcement":
          processed.description = result.product_description || "Enforcement action";
          processed.date = result.report_date || "Unknown";
          processed.status = result.status || "Unknown";
          break;
        case "adverse":
          processed.description = result.device?.[0]?.device_report_product_code || "Adverse event";
          processed.date = result.date_received || "Unknown";
          processed.status = "Reported";
          break;
        case "udi":
          processed.description = result.brand_name || "Device identifier";
          processed.date = result.version_or_model_date || "Unknown";
          processed.status = "Active";
          break;
        case "pma":
          processed.description = result.device_name || "PMA submission";
          processed.date = result.decision_date || "Unknown";
          processed.status = result.decision || "Unknown";
          break;
      }
    }
    return processed;
  });
}

// Express server setup
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.json());

// List of competitors
const competitors = [
  "LivaNova",
  "Medtronic",
  "NeuroPace",
  "XCOPRI",
  "Precisis AG",
  "Epi-Minder",
  "Flow Medical"
];

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    logger.info(`Data directory ensured at ${DATA_DIR}`);
  } catch (error) {
    logger.error(`Failed to create data directory: ${error.message}`);
    throw error;
  }
}

// Save data to file
async function saveToFile(competitor, data) {
  const fileName = `${competitor.replace(/\s+/g, '_')}.json`; // Replace spaces with underscores
  const filePath = path.join(DATA_DIR, fileName);
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    logger.info(`Saved data for ${competitor} to ${filePath}`);
  } catch (error) {
    logger.error(`Failed to save data for ${competitor} to ${filePath}: ${error.message}`);
    throw error;
  }
}

// Endpoint to fetch and save FDA data for all competitors
app.get('/api/fda-data', async (req, res) => {
  try {
    logger.info('Starting FDA data fetch and save for all competitors');
    const startTime = Date.now();

    // Ensure data directory exists
    await ensureDataDir();

    // Fetch data for all competitors concurrently
    const fetchPromises = competitors.map(competitor =>
      fetchFdaData(competitor)
        .then(data => {
          // Save to file after fetching
          return saveToFile(competitor, data).then(() => ({ competitor, data }));
        })
        .catch(error => {
          logger.error(`Failed to fetch or save data for ${competitor}: ${error.message}`);
          const errorData = { endpoints: {}, combinedResults: [{ source: "error", name: competitor, description: error.message, date: "Unknown", status: "Error" }] };
          return saveToFile(competitor, errorData).then(() => ({ competitor, data: errorData }));
        })
    );

    const allResults = await Promise.all(fetchPromises);
    const responseData = Object.fromEntries(allResults.map(({ competitor, data }) => [competitor, data]));

    const duration = (Date.now() - startTime) / 1000;
    logger.info(`Completed FDA data fetch and save for all competitors in ${duration}s`);

    res.status(200).json({
      status: "success",
      data: responseData,
      timestamp: new Date().toISOString(),
      duration: `${duration}s`
    });
  } catch (error) {
    logger.error(`Server error: ${error.message}`);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message
    });
  }
});

// Start the server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});