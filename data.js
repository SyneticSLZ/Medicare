/**
 * Comprehensive Data Endpoint
 * 
 * This file provides a single endpoint that returns all the necessary data
 * for the frontend application, including:
 * - HCPCS code data by directory and year
 * - Reimbursement rates
 * - Payment rates
 * - Historical trends
 * - Market data
 * 
 * Add this to your routes folder and include it in your server.js
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { 
  calculateAllReimbursements, 
  calculateReimbursementRate,
  calculatePercentageChange
} = require('./reimb.js');

const {
  processABFiles,
  combineRatesData,
  TARGET_CODES
} = require('./ab-payment-processor.js');

// Global cache for better performance
let dataCache = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds

/**
 * Main endpoint to get all data in one request
 */
router.get('/api/data', async (req, res) => {
  try {
    const refresh = req.query.refresh === 'true';
    const data = await getComprehensiveData(refresh);
    res.json(data);
  } catch (error) {
    console.error('Error fetching comprehensive data:', error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

/**
 * Get only the summary data (for dashboard)
 */
router.get('/api/data/summary', async (req, res) => {
  try {
    const refresh = req.query.refresh === 'true';
    const data = await getComprehensiveData(refresh);
    res.json({
      metadata: data.metadata,
      summary: data.summary
    });
  } catch (error) {
    console.error('Error fetching summary data:', error);
    res.status(500).json({ error: 'Failed to fetch summary data' });
  }
});

/**
 * Get historical data for a specific code
 */
router.get('/api/data/history/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const refresh = req.query.refresh === 'true';
    const data = await getComprehensiveData(refresh);
    
    const history = {
      reimbursement: {},
      payment: {},
      combined: {},
      changes: {}
    };
    
    // Find reimbursement data and changes for this code
    for (const dir in data.reimbursementData) {
      const rates = data.reimbursementData[dir].rates || {};
      const changes = data.reimbursementData[dir].changes || {};
      
      // Get rates by year
      for (const year in rates) {
        if (rates[year][code] !== undefined) {
          history.reimbursement[year] = rates[year][code];
        }
      }
      
      // Get changes
      if (changes[code]) {
        history.changes = changes[code];
      }
    }
    
    // Get payment data
    for (const year in data.paymentData) {
      if (data.paymentData[year][code] !== undefined) {
        history.payment[year] = data.paymentData[year][code];
      }
    }
    
    // Get combined data
    if (data.combinedRates.byCode[code]) {
      for (const year in data.combinedRates.byCode[code]) {
        if (typeof data.combinedRates.byCode[code][year] === 'object') {
          history.combined[year] = data.combinedRates.byCode[code][year];
        }
      }
    }
    
    res.json(history);
  } catch (error) {
    console.error('Error fetching historical data:', error);
    res.status(500).json({ error: 'Failed to fetch historical data' });
  }
});

/**
 * Calculate reimbursement for a given set of parameters
 */
router.post('/api/calculate', (req, res) => {
  try {
    const { 
      workRVU, 
      peRVU, 
      mpRVU, 
      workGPCI = 1.0, 
      peGPCI = 1.0, 
      mpGPCI = 1.0,
      conversionFactor
    } = req.body;
    
    // Validate inputs
    if (
      workRVU === undefined || 
      peRVU === undefined || 
      mpRVU === undefined || 
      conversionFactor === undefined
    ) {
      return res.status(400).json({ 
        error: 'Missing required parameters. Please provide workRVU, peRVU, mpRVU, and conversionFactor.'
      });
    }
    
    // Calculate using the formula
    const reimbursement = ((workRVU * workGPCI) + (peRVU * peGPCI) + (mpRVU * mpGPCI)) * conversionFactor;
    
    res.json({
      inputs: {
        workRVU,
        peRVU,
        mpRVU,
        workGPCI,
        peGPCI,
        mpGPCI,
        conversionFactor
      },
      result: parseFloat(reimbursement.toFixed(2))
    });
  } catch (error) {
    console.error('Error calculating reimbursement:', error);
    res.status(500).json({ error: 'Failed to calculate reimbursement' });
  }
});

/**
 * Get data for a specific code
 */
router.get('/api/data/code/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const refresh = req.query.refresh === 'true';
    const data = await getComprehensiveData(refresh);
    
    // Extract code-specific data
    const codeData = {
      metadata: data.metadata,
      reimbursement: {},
      payment: {},
      combined: data.combinedRates.byCode[code] || {},
      market: data.market.marketShare[code] || []
    };
    
    // Find reimbursement data for this code
    for (const dir in data.reimbursementData) {
      const rates = data.reimbursementData[dir].rates || {};
      
      for (const year in rates) {
        if (rates[year][code] !== undefined) {
          if (!codeData.reimbursement[year]) {
            codeData.reimbursement[year] = {};
          }
          codeData.reimbursement[year] = rates[year][code];
        }
      }
    }
    
    // Find payment data for this code
    for (const year in data.paymentData) {
      if (data.paymentData[year][code] !== undefined) {
        codeData.payment[year] = data.paymentData[year][code];
      }
    }
    
    res.json(codeData);
  } catch (error) {
    console.error('Error fetching code data:', error);
    res.status(500).json({ error: 'Failed to fetch code data' });
  }
});

/**
 * Get all data for a specific directory (code group)
 */
router.get('/api/data/directory/:dir', async (req, res) => {
  try {
    const { dir } = req.params;
    const refresh = req.query.refresh === 'true';
    const data = await getComprehensiveData(refresh);
    
    // Check if directory exists
    if (!data.rawData[dir]) {
      return res.status(404).json({ error: `Directory '${dir}' not found` });
    }
    
    // Extract directory-specific data
    const dirData = {
      metadata: data.metadata,
      rawData: data.rawData[dir],
      reimbursement: data.reimbursementData[dir],
      combined: data.combinedRates.byDirectory[dir],
      market: data.market.segments[dir] || {}
    };
    
    res.json(dirData);
  } catch (error) {
    console.error('Error fetching directory data:', error);
    res.status(500).json({ error: 'Failed to fetch directory data' });
  }
});

/**
 * Get all market data
 */
router.get('/api/data/market', async (req, res) => {
  try {
    const refresh = req.query.refresh === 'true';
    const data = await getComprehensiveData(refresh);
    
    res.json(data.market);
  } catch (error) {
    console.error('Error fetching market data:', error);
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});

/**
 * Get trends data for charts
 */
router.get('/api/data/trends', async (req, res) => {
  try {
    const refresh = req.query.refresh === 'true';
    const data = await getComprehensiveData(refresh);
    
    const trends = {
      yearlyAverages: data.summary.yearlyTrends,
      codeGroups: {},
      topCodes: {}
    };
    
    // Transform data for easier charting
    for (const dir in data.reimbursementData) {
      trends.codeGroups[dir] = {
        years: {},
        averageByYear: {}
      };
      
      // Calculate average by year for this directory
      for (const year in data.reimbursementData[dir].rates) {
        const rates = data.reimbursementData[dir].rates[year];
        const total = Object.values(rates).reduce((sum, rate) => sum + rate, 0);
        const count = Object.values(rates).length;
        
        trends.codeGroups[dir].years[year] = rates;
        trends.codeGroups[dir].averageByYear[year] = count > 0 ? total / count : 0;
      }
    }
    
    // Get trend data for top 5 codes by reimbursement
    const topCodes = data.summary.highestReimbursement.map(item => item.code);
    
    topCodes.forEach(code => {
      trends.topCodes[code] = {
        reimbursement: {},
        payment: {},
        combined: {}
      };
      
      // Collect reimbursement data
      for (const dir in data.reimbursementData) {
        for (const year in data.reimbursementData[dir].rates) {
          if (data.reimbursementData[dir].rates[year][code] !== undefined) {
            trends.topCodes[code].reimbursement[year] = data.reimbursementData[dir].rates[year][code];
          }
        }
      }
      
      // Collect payment data
      for (const year in data.paymentData) {
        if (data.paymentData[year][code] !== undefined) {
          trends.topCodes[code].payment[year] = data.paymentData[year][code];
        }
      }
      
      // Collect combined data
      if (data.combinedRates.byCode[code]) {
        for (const year in data.combinedRates.byCode[code]) {
          if (typeof data.combinedRates.byCode[code][year] === 'object') {
            trends.topCodes[code].combined[year] = {
              reimbursement: data.combinedRates.byCode[code][year].reimbursement,
              payment: data.combinedRates.byCode[code][year].payment,
              total: data.combinedRates.byCode[code][year].combined
            };
          }
        }
      }
    });
    
    res.json(trends);
  } catch (error) {
    console.error('Error fetching trends data:', error);
    res.status(500).json({ error: 'Failed to fetch trends data' });
  }
});

/**
 * Compatibility route for market-values
 */
router.get('/market-values', async (req, res) => {
  try {
    const refresh = req.query.refresh === 'true';
    const data = await getComprehensiveData(refresh);
    
    res.json({
      status: 'success',
      data: data.market,
      year: data.market.year,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching market values:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Export the router for use in server.js
module.exports = router;