/**
 * API Routes for Reimbursement and Payment Calculator
 * 
 * This file contains Express routes to access reimbursement and payment calculations.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { 
  calculateAllReimbursements, 
  generateReport 
} = require('./reimb.js');

const {
  processABFiles,
  combineRatesData,
  generateCombinedReport,
  TARGET_CODES
} = require('./ab-payment-processor.js');

// Global cache to store calculation results
let calculationCache = null;
let combinedCache = null;
let lastCalculationTime = 0;
const CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds

/**
 * Helper function to get fresh or cached calculations
 */
async function getCalculations(forceRefresh = false) {
  const now = Date.now();
  
  // Use cached results if available and not expired
  if (
    !forceRefresh && 
    calculationCache && 
    combinedCache &&
    (now - lastCalculationTime) < CACHE_TTL
  ) {
    return {
      reimbursementData: calculationCache,
      combinedData: combinedCache
    };
  }
  
  // Calculate fresh results
  const calculationOptions = {
    dataDir: path.join(__dirname, 'data'),
    directories: ['618', '645', '959'],
    years: ['2020', '2021', '2022', '2023', '2024A', '2024B', '2025'],
    facilityType: 'facility' // 'facility' or 'non-facility'
  };
  
  // Process AB files for payment data
  const abPaymentData = await processABFiles({
    abDir: path.join(__dirname, 'data', 'AB'),
    targetCodes: TARGET_CODES
  });
  
  // Perform reimbursement calculations
  const reimbursementData = await calculateAllReimbursements(calculationOptions);
  
  // Combine reimbursement and payment data
  const combinedData = combineRatesData(reimbursementData, abPaymentData);
  
  // Update cache
  calculationCache = reimbursementData;
  combinedCache = combinedData;
  lastCalculationTime = now;
  
  return {
    reimbursementData,
    combinedData
  };
}

/**
 * Route to get JSON reimbursement data
 */
router.get('/api/reimbursement', async (req, res) => {
  try {
    const refresh = req.query.refresh === 'true';
    const { reimbursementData } = await getCalculations(refresh);
    res.json(reimbursementData);
  } catch (error) {
    console.error('Error calculating reimbursements:', error);
    res.status(500).json({ error: 'Failed to calculate reimbursements' });
  }
});

/**
 * Route to get reimbursement data for a specific code group
 */
router.get('/api/reimbursement/:group', async (req, res) => {
  try {
    const { group } = req.params;
    const refresh = req.query.refresh === 'true';
    const { reimbursementData } = await getCalculations(refresh);
    
    if (!reimbursementData[group]) {
      return res.status(404).json({ error: `Group '${group}' not found` });
    }
    
    res.json(reimbursementData[group]);
  } catch (error) {
    console.error('Error calculating reimbursements for group:', error);
    res.status(500).json({ error: 'Failed to calculate reimbursements' });
  }
});

/**
 * Route to get combined reimbursement and payment data
 */
router.get('/api/combined-rates', async (req, res) => {
  try {
    const refresh = req.query.refresh === 'true';
    const { combinedData } = await getCalculations(refresh);
    res.json(combinedData);
  } catch (error) {
    console.error('Error calculating combined rates:', error);
    res.status(500).json({ error: 'Failed to calculate combined rates' });
  }
});

/**
 * Route to get combined data for a specific code
 */
router.get('/api/combined-rates/code/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const refresh = req.query.refresh === 'true';
    const { combinedData } = await getCalculations(refresh);
    
    if (!combinedData.byCode[code]) {
      return res.status(404).json({ error: `Code '${code}' not found` });
    }
    
    res.json(combinedData.byCode[code]);
  } catch (error) {
    console.error('Error retrieving data for code:', error);
    res.status(500).json({ error: 'Failed to retrieve code data' });
  }
});

/**
 * Route to get combined data for a specific directory
 */
router.get('/api/combined-rates/directory/:dir', async (req, res) => {
  try {
    const { dir } = req.params;
    const refresh = req.query.refresh === 'true';
    const { combinedData } = await getCalculations(refresh);
    
    if (!combinedData.byDirectory[dir]) {
      return res.status(404).json({ error: `Directory '${dir}' not found` });
    }
    
    res.json(combinedData.byDirectory[dir]);
  } catch (error) {
    console.error('Error retrieving data for directory:', error);
    res.status(500).json({ error: 'Failed to retrieve directory data' });
  }
});

/**
 * Route to get HTML report of reimbursement data only
 */
router.get('/reimbursement-report', async (req, res) => {
  try {
    const refresh = req.query.refresh === 'true';
    const { reimbursementData } = await getCalculations(refresh);
    const htmlReport = generateReport(reimbursementData, 'html');
    
    res.send(htmlReport);
  } catch (error) {
    console.error('Error generating reimbursement report:', error);
    res.status(500).send('Failed to generate reimbursement report');
  }
});

/**
 * Route to get HTML report of combined data (includes payment rates)
 */
router.get('/combined-report', async (req, res) => {
  try {
    const refresh = req.query.refresh === 'true';
    const { combinedData } = await getCalculations(refresh);
    const htmlReport = generateCombinedReport(combinedData);
    
    res.send(htmlReport);
  } catch (error) {
    console.error('Error generating combined report:', error);
    res.status(500).send('Failed to generate combined report');
  }
});

/**
 * Route to get combined report for a specific code
 */
router.get('/combined-report/code/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const refresh = req.query.refresh === 'true';
    const { combinedData } = await getCalculations(refresh);
    
    if (!combinedData.byCode[code]) {
      return res.status(404).send(`Code '${code}' not found`);
    }
    
    // Create a filtered version with just this code
    const filteredData = {
      byCode: { [code]: combinedData.byCode[code] },
      byDirectory: {}
    };
    
    // Find which directory contains this code
    for (const dir in combinedData.byDirectory) {
      const years = Object.keys(combinedData.byDirectory[dir]).filter(k => k !== 'changes');
      let codeExists = false;
      
      for (const year of years) {
        if (combinedData.byDirectory[dir][year][code]) {
          codeExists = true;
          break;
        }
      }
      
      if (codeExists) {
        filteredData.byDirectory[dir] = {};
        
        // Copy data for just this code
        for (const year of years) {
          if (combinedData.byDirectory[dir][year][code]) {
            if (!filteredData.byDirectory[dir][year]) {
              filteredData.byDirectory[dir][year] = {};
            }
            filteredData.byDirectory[dir][year][code] = combinedData.byDirectory[dir][year][code];
          }
        }
        
        // Copy changes if they exist
        if (combinedData.byDirectory[dir].changes && combinedData.byDirectory[dir].changes[code]) {
          filteredData.byDirectory[dir].changes = {
            [code]: combinedData.byDirectory[dir].changes[code]
          };
        }
      }
    }
    
    const htmlReport = generateCombinedReport(filteredData);
    res.send(htmlReport);
  } catch (error) {
    console.error('Error generating report for code:', error);
    res.status(500).send('Failed to generate report');
  }
});

/**
 * Route to get combined report for a specific directory
 */
router.get('/combined-report/directory/:dir', async (req, res) => {
  try {
    const { dir } = req.params;
    const refresh = req.query.refresh === 'true';
    const { combinedData } = await getCalculations(refresh);
    
    if (!combinedData.byDirectory[dir]) {
      return res.status(404).send(`Directory '${dir}' not found`);
    }
    
    // Create a filtered version with just this directory
    const filteredData = {
      byDirectory: { [dir]: combinedData.byDirectory[dir] },
      byCode: {}
    };
    
    // Copy relevant codes to byCode for completeness
    const years = Object.keys(combinedData.byDirectory[dir]).filter(k => k !== 'changes');
    for (const year of years) {
      const codes = Object.keys(combinedData.byDirectory[dir][year] || {});
      
      for (const code of codes) {
        if (!filteredData.byCode[code]) {
          filteredData.byCode[code] = {};
        }
        
        if (combinedData.byCode[code] && combinedData.byCode[code][year]) {
          filteredData.byCode[code][year] = combinedData.byCode[code][year];
        }
      }
    }
    
    const htmlReport = generateCombinedReport(filteredData);
    res.send(htmlReport);
  } catch (error) {
    console.error('Error generating report for directory:', error);
    res.status(500).send('Failed to generate report');
  }
});

// Export the router
module.exports = router;

// /**
//  * API Routes for Reimbursement Calculator
//  * 
//  * This file contains Express routes to access reimbursement calculations.
//  */

// const express = require('express');
// const path = require('path');
// const fs = require('fs');
// const router = express.Router();
// const { 
//   calculateAllReimbursements, 
//   generateReport 
// } = require('./reimb');

// // Global cache to store calculation results
// let calculationCache = null;
// let lastCalculationTime = 0;
// const CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds

// /**
//  * Helper function to get fresh or cached calculations
//  */
// async function getCalculations(forceRefresh = false) {
//   const now = Date.now();
  
//   // Use cached results if available and not expired
//   if (
//     !forceRefresh && 
//     calculationCache && 
//     (now - lastCalculationTime) < CACHE_TTL
//   ) {
//     return calculationCache;
//   }
  
//   // Calculate fresh results
//   const calculationOptions = {
//     dataDir: path.join(__dirname, 'data'),
//     directories: ['618', '645', '959'],
//     years: ['2020', '2021', '2022', '2023', '2024A', '2024B', '2025'],
//     facilityType: 'facility' // 'facility' or 'non-facility'
//   };
  
//   // Perform calculations
//   const results = await calculateAllReimbursements(calculationOptions);
  
//   // Update cache
//   calculationCache = results;
//   lastCalculationTime = now;
  
//   return results;
// }

// /**
//  * Route to get JSON reimbursement data
//  */
// router.get('/api/reimbursement', async (req, res) => {
//   try {
//     const refresh = req.query.refresh === 'true';
//     const results = await getCalculations(refresh);
//     res.json(results);
//   } catch (error) {
//     console.error('Error calculating reimbursements:', error);
//     res.status(500).json({ error: 'Failed to calculate reimbursements' });
//   }
// });

// /**
//  * Route to get reimbursement data for a specific code group
//  */
// router.get('/api/reimbursement/:group', async (req, res) => {
//   try {
//     const { group } = req.params;
//     const refresh = req.query.refresh === 'true';
//     const results = await getCalculations(refresh);
    
//     if (!results[group]) {
//       return res.status(404).json({ error: `Group '${group}' not found` });
//     }
    
//     res.json(results[group]);
//   } catch (error) {
//     console.error('Error calculating reimbursements for group:', error);
//     res.status(500).json({ error: 'Failed to calculate reimbursements' });
//   }
// });

// /**
//  * Route to get HTML report of reimbursement data
//  */
// router.get('/reimbursement-report', async (req, res) => {
//   try {
//     const refresh = req.query.refresh === 'true';
//     const results = await getCalculations(refresh);
//     const htmlReport = generateReport(results, 'html');
    
//     res.send(htmlReport);
//   } catch (error) {
//     console.error('Error generating reimbursement report:', error);
//     res.status(500).send('Failed to generate reimbursement report');
//   }
// });

// /**
//  * Route to get reimbursement report for a specific group
//  */
// router.get('/reimbursement-report/:group', async (req, res) => {
//   try {
//     const { group } = req.params;
//     const refresh = req.query.refresh === 'true';
//     const results = await getCalculations(refresh);
    
//     if (!results[group]) {
//       return res.status(404).send(`Group '${group}' not found`);
//     }
    
//     // Create a single-group results object
//     const singleGroupResults = { [group]: results[group] };
//     const htmlReport = generateReport(singleGroupResults, 'html');
    
//     res.send(htmlReport);
//   } catch (error) {
//     console.error('Error generating reimbursement report for group:', error);
//     res.status(500).send('Failed to generate reimbursement report');
//   }
// });

// // Export the router
// module.exports = router;