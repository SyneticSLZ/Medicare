/**
 * AB Payment Data Processor
 * 
 * This module processes the AB folder files and extracts payment rates for specific codes.
 * It also compares those rates with the calculated reimbursement rates.
 */

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

// List of target HCPCS codes to track (you can modify this list)
const TARGET_CODES = [
  '61885', '61888', // From 618 directory
  '64568', '64569', '64570', // From 645 directory
  '95970', '95976', '95977', '95983', // From 959 directory
  '0001A', '0002A', '0003A', '0004A' // From your example
];

/**
 * Map AB folder filenames to years
 * @param {String} filename - The AB folder filename
 * @return {String} The corresponding year
 */
function getYearFromABFilename(filename) {
  // Handle different naming patterns
  if (filename.startsWith('2020_january')) return '2020';
  if (filename.startsWith('2021_january')) return '2021';
  if (filename.startsWith('2023_january')) return '2023';
  if (filename.includes('2025')) return '2025';
  if (filename.includes('2022')) return '2022';
  if (filename.includes('2024')) return '2024';
  
  // Extract year from filename if it exists
  const yearMatch = filename.match(/20\d\d/);
  if (yearMatch) {
    return yearMatch[0];
  }
  
  // Default if no match found
  return 'unknown';
}

/**
 * Read and parse an AB file
 * @param {String} filePath - Path to the AB file
 * @return {Promise<Array>} - Array of parsed data
 */
async function readABFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, fileContent) => {
      if (err) {
        return reject(err);
      }
      
      try {
        // Parse CSV
        const parsed = Papa.parse(fileContent, {
          header: true,
          skipEmptyLines: true,
          transformHeader: header => header.trim()
        });
        
        resolve(parsed.data);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Process all AB files and extract payment rates for target codes
 * @param {Object} options - Processing options
 * @return {Promise<Object>} - Payment rates by year and code
 */
async function processABFiles(options = {}) {
  const {
    abDir = path.join(__dirname, 'data', 'AB'),
    targetCodes = TARGET_CODES
  } = options;
  
  // Check if directory exists
  if (!fs.existsSync(abDir)) {
    console.warn(`AB directory not found: ${abDir}`);
    return {};
  }
  
  // Get list of files
  const files = fs.readdirSync(abDir);
  
  // Results object organized by year
  const results = {};
  
  // Process each file
  for (const file of files) {
    // Skip non-CSV files
    if (!file.endsWith('.csv')) continue;
    
    const filePath = path.join(abDir, file);
    const year = getYearFromABFilename(file);
    
    console.log(`Processing AB file for year ${year}: ${file}`);
    
    try {
      // Read and parse file
      const data = await readABFile(filePath);
      
      // Initialize year entry if not exists
      if (!results[year]) {
        results[year] = {};
      }
      
      // Extract payment rates for target codes
      data.forEach(row => {
        const code = row['HCPCS Code']?.trim();
        if (code && targetCodes.includes(code)) {
          // Get payment rate, convert to number
          let paymentRate = row['Payment Rate'];
          if (paymentRate) {
            // Remove $ and convert to number
            paymentRate = paymentRate.replace(/\$/g, '').trim();
            paymentRate = parseFloat(paymentRate);
            
            // Store in results
            if (!isNaN(paymentRate)) {
              results[year][code] = paymentRate;
            }
          }
        }
      });
    } catch (error) {
      console.error(`Error processing AB file ${file}:`, error);
    }
  }
  
  return results;
}

/**
 * Combine reimbursement rates with payment rates
 * @param {Object} reimbursementData - Reimbursement data by directory and year
 * @param {Object} paymentData - Payment data by year and code
 * @return {Object} - Combined data
 */
function combineRatesData(reimbursementData, paymentData) {
  const combined = {
    byDirectory: {},
    byCode: {}
  };
  
  // Map standard years to possible AB file years
  const yearMap = {
    '2020': ['2020'],
    '2021': ['2021'],
    '2022': ['2022'],
    '2023': ['2023'],
    '2024A': ['2024', '2024A'],
    '2024B': ['2024', '2024B'],
    '2025': ['2025']
  };
  
  // Process each directory in reimbursement data
  for (const dir in reimbursementData) {
    combined.byDirectory[dir] = {};
    
    // Get rates by year
    const yearlyRates = reimbursementData[dir].rates || {};
    
    // Process each year
    for (const year in yearlyRates) {
      const codeRates = yearlyRates[year];
      
      // Find corresponding payment year
      const possiblePaymentYears = yearMap[year] || [year];
      let paymentYear = null;
      
      // Find the first matching payment year
      for (const py of possiblePaymentYears) {
        if (paymentData[py]) {
          paymentYear = py;
          break;
        }
      }
      
      // Process each code
      for (const code in codeRates) {
        // Get reimbursement rate
        const reimbursementRate = codeRates[code];
        
        // Get payment rate if available
        const paymentRate = paymentYear && paymentData[paymentYear][code] ? 
          paymentData[paymentYear][code] : null;
        
        // Calculate combined rate
        const combinedRate = paymentRate && !isNaN(reimbursementRate) ? 
          parseFloat((reimbursementRate + paymentRate).toFixed(2)) : reimbursementRate;
        
        // Store in directory-based results
        if (!combined.byDirectory[dir][year]) {
          combined.byDirectory[dir][year] = {};
        }
        combined.byDirectory[dir][year][code] = {
          reimbursement: reimbursementRate,
          payment: paymentRate,
          combined: combinedRate
        };
        
        // Also store in code-based results for easier lookup
        if (!combined.byCode[code]) {
          combined.byCode[code] = {};
        }
        if (!combined.byCode[code][year]) {
          combined.byCode[code][year] = {};
        }
        combined.byCode[code][year] = {
          reimbursement: reimbursementRate,
          payment: paymentRate,
          combined: combinedRate,
          directory: dir
        };
      }
    }
    
    // Calculate percentage changes including combined rates
    const changes = calculateCombinedChanges(combined.byDirectory[dir]);
    combined.byDirectory[dir].changes = changes;
  }
  
  return combined;
}

/**
 * Calculate percentage changes for combined data
 * @param {Object} dirData - Directory data with years and code rates
 * @return {Object} - Percentage changes
 */
function calculateCombinedChanges(dirData) {
  const changes = {};
  const years = Object.keys(dirData).filter(key => key !== 'changes');
  
  // Sort years
  years.sort((a, b) => {
    // Extract year part (e.g., "2024" from "2024A")
    const yearA = a.substring(0, 4);
    const yearB = b.substring(0, 4);
    
    // Compare year part first
    if (yearA !== yearB) {
      return parseInt(yearA) - parseInt(yearB);
    }
    
    // If year parts are same, compare the full string
    return a.localeCompare(b);
  });
  
  // Get all codes
  const allCodes = new Set();
  for (const year of years) {
    Object.keys(dirData[year] || {}).forEach(code => allCodes.add(code));
  }
  
  // Calculate changes for each code
  for (const code of allCodes) {
    changes[code] = {};
    
    for (let i = 1; i < years.length; i++) {
      const prevYear = years[i-1];
      const currYear = years[i];
      
      // Skip if data missing for either year
      if (!dirData[prevYear] || !dirData[currYear] || 
          !dirData[prevYear][code] || !dirData[currYear][code]) {
        continue;
      }
      
      // Calculate changes for each rate type
      const prevData = dirData[prevYear][code];
      const currData = dirData[currYear][code];
      
      changes[code][`${prevYear} to ${currYear}`] = {
        reimbursement: calculatePercentageChange(prevData.reimbursement, currData.reimbursement),
        payment: calculatePercentageChange(prevData.payment, currData.payment),
        combined: calculatePercentageChange(prevData.combined, currData.combined)
      };
    }
  }
  
  return changes;
}

/**
 * Calculate percentage change between two values
 * @param {Number} oldValue - Previous value
 * @param {Number} newValue - Current value
 * @return {Number} - Percentage change
 */
function calculatePercentageChange(oldValue, newValue) {
  // Handle null values
  if (oldValue === null || newValue === null || 
      isNaN(oldValue) || isNaN(newValue)) {
    return null;
  }
  
  // Handle zero values
  if (oldValue === 0) return 0;
  
  const percentChange = ((newValue - oldValue) / oldValue) * 100;
  return parseFloat(percentChange.toFixed(2));
}

/**
 * Generate HTML report for combined data
 * @param {Object} combinedData - Combined reimbursement and payment data
 * @return {String} - HTML report
 */
function generateCombinedReport(combinedData) {
  let html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HCPCS Payment and Reimbursement Analysis</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; }
      h1, h2, h3 { color: #333; }
      .tabs { display: flex; margin-bottom: 20px; }
      .tab { 
        padding: 10px 20px; 
        background-color: #f0f0f0; 
        cursor: pointer; 
        border: 1px solid #ccc;
        border-bottom: none;
      }
      .tab.active { 
        background-color: #fff; 
        font-weight: bold;
        border-bottom: 1px solid #fff;
        margin-bottom: -1px;
      }
      .tab-content {
        display: none;
        padding: 20px;
        border: 1px solid #ccc;
      }
      .tab-content.active { display: block; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: right; }
      th { background-color: #f2f2f2; text-align: center; }
      tr:nth-child(even) { background-color: #f9f9f9; }
      .code-cell { text-align: left; font-weight: bold; }
      .positive-change { color: green; }
      .negative-change { color: red; }
      .section { margin-bottom: 30px; }
      .rate-type { font-style: italic; color: #666; }
      .missing-data { color: #999; font-style: italic; }
    </style>
  </head>
  <body>
    <h1>HCPCS Payment and Reimbursement Analysis</h1>
    
    <div class="tabs">
      <div class="tab active" onclick="showTab('overview')">Overview</div>
      <div class="tab" onclick="showTab('byDirectory')">By Directory</div>
      <div class="tab" onclick="showTab('byCode')">By Code</div>
    </div>
    
    <div id="overview" class="tab-content active">
      <h2>Overview</h2>
      <p>This report combines Medicare reimbursement rates (calculated using the RVU formula) with payment rates from the AB files.</p>
      <p>Three values are shown for each code:</p>
      <ul>
        <li><strong>Reimbursement Rate:</strong> Calculated using [(Work RVU × Work GPCI) + (PE RVU × PE GPCI) + (MP RVU × MP GPCI)] × Conversion Factor</li>
        <li><strong>Payment Rate:</strong> Direct payment value from AB files</li>
        <li><strong>Combined Rate:</strong> Sum of reimbursement and payment rates</li>
      </ul>
      <p>Click the tabs above to view data organized by directory or by code.</p>
    </div>
    
    <div id="byDirectory" class="tab-content">
      <h2>Analysis by Directory</h2>
  `;
  
  // Add directory sections
  for (const dir in combinedData.byDirectory) {
    const dirData = combinedData.byDirectory[dir];
    
    html += `
      <div class="section">
        <h3>HCPCS Codes in Group ${dir}</h3>
        
        <h4>Rates by Year</h4>
        <table>
          <thead>
            <tr>
              <th rowspan="2">HCPCS Code</th>
              <th rowspan="2">Rate Type</th>
    `;
    
    // Get all years for this directory
    const years = Object.keys(dirData).filter(key => key !== 'changes');
    years.sort();
    
    // Add year columns
    for (const year of years) {
      html += `<th>${year}</th>`;
    }
    
    html += `
            </tr>
          </thead>
          <tbody>
    `;
    
    // Get all codes
    const codes = new Set();
    for (const year of years) {
      Object.keys(dirData[year] || {}).forEach(code => codes.add(code));
    }
    const sortedCodes = [...codes].sort();
    
    // Add rows for each code and rate type
    for (const code of sortedCodes) {
      // Reimbursement row
      html += `
        <tr>
          <td class="code-cell" rowspan="3">${code}</td>
          <td class="rate-type">Reimbursement</td>
      `;
      
      for (const year of years) {
        const value = dirData[year]?.[code]?.reimbursement;
        html += `<td>${value !== null && value !== undefined ? value.toFixed(2) : '<span class="missing-data">N/A</span>'}</td>`;
      }
      
      html += `</tr>`;
      
      // Payment row
      html += `<tr><td class="rate-type">Payment</td>`;
      
      for (const year of years) {
        const value = dirData[year]?.[code]?.payment;
        html += `<td>${value !== null && value !== undefined ? value.toFixed(2) : '<span class="missing-data">N/A</span>'}</td>`;
      }
      
      html += `</tr>`;
      
      // Combined row
      html += `<tr><td class="rate-type">Combined</td>`;
      
      for (const year of years) {
        const value = dirData[year]?.[code]?.combined;
        html += `<td>${value !== null && value !== undefined ? value.toFixed(2) : '<span class="missing-data">N/A</span>'}</td>`;
      }
      
      html += `</tr>`;
    }
    
    html += `
          </tbody>
        </table>
        
        <h4>Percentage Changes Year-over-Year</h4>
        <table>
          <thead>
            <tr>
              <th>HCPCS Code</th>
              <th>Rate Type</th>
    `;
    
    // Get change periods
    const changes = dirData.changes || {};
    const periods = new Set();
    for (const code in changes) {
      Object.keys(changes[code]).forEach(period => periods.add(period));
    }
    const sortedPeriods = [...periods].sort();
    
    // Add period columns
    for (const period of sortedPeriods) {
      html += `<th>${period}</th>`;
    }
    
    html += `
            </tr>
          </thead>
          <tbody>
    `;
    
    // Add rows for each code and change type
    for (const code of sortedCodes) {
      const codeChanges = changes[code] || {};
      
      // Reimbursement changes
      html += `
        <tr>
          <td class="code-cell" rowspan="3">${code}</td>
          <td class="rate-type">Reimbursement</td>
      `;
      
      for (const period of sortedPeriods) {
        const value = codeChanges[period]?.reimbursement;
        
        if (value !== null && value !== undefined) {
          const cssClass = value >= 0 ? 'positive-change' : 'negative-change';
          const sign = value >= 0 ? '+' : '';
          html += `<td class="${cssClass}">${sign}${value}%</td>`;
        } else {
          html += `<td><span class="missing-data">N/A</span></td>`;
        }
      }
      
      html += `</tr>`;
      
      // Payment changes
      html += `<tr><td class="rate-type">Payment</td>`;
      
      for (const period of sortedPeriods) {
        const value = codeChanges[period]?.payment;
        
        if (value !== null && value !== undefined) {
          const cssClass = value >= 0 ? 'positive-change' : 'negative-change';
          const sign = value >= 0 ? '+' : '';
          html += `<td class="${cssClass}">${sign}${value}%</td>`;
        } else {
          html += `<td><span class="missing-data">N/A</span></td>`;
        }
      }
      
      html += `</tr>`;
      
      // Combined changes
      html += `<tr><td class="rate-type">Combined</td>`;
      
      for (const period of sortedPeriods) {
        const value = codeChanges[period]?.combined;
        
        if (value !== null && value !== undefined) {
          const cssClass = value >= 0 ? 'positive-change' : 'negative-change';
          const sign = value >= 0 ? '+' : '';
          html += `<td class="${cssClass}">${sign}${value}%</td>`;
        } else {
          html += `<td><span class="missing-data">N/A</span></td>`;
        }
      }
      
      html += `</tr>`;
    }
    
    html += `
          </tbody>
        </table>
      </div>
    `;
  }
  
  // By code tab
  html += `
    </div>
    
    <div id="byCode" class="tab-content">
      <h2>Analysis by Code</h2>
  `;
  
  // Add section for each code
  const allCodes = Object.keys(combinedData.byCode).sort();
  
  for (const code of allCodes) {
    const codeData = combinedData.byCode[code];
    const years = Object.keys(codeData).sort();
    
    html += `
      <div class="section">
        <h3>HCPCS Code: ${code}</h3>
        <table>
          <thead>
            <tr>
              <th>Year</th>
              <th>Directory</th>
              <th>Reimbursement Rate</th>
              <th>Payment Rate</th>
              <th>Combined Rate</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    for (const year of years) {
      const yearData = codeData[year];
      
      html += `
        <tr>
          <td>${year}</td>
          <td>${yearData.directory || 'N/A'}</td>
          <td>${yearData.reimbursement !== null && yearData.reimbursement !== undefined ? yearData.reimbursement.toFixed(2) : '<span class="missing-data">N/A</span>'}</td>
          <td>${yearData.payment !== null && yearData.payment !== undefined ? yearData.payment.toFixed(2) : '<span class="missing-data">N/A</span>'}</td>
          <td>${yearData.combined !== null && yearData.combined !== undefined ? yearData.combined.toFixed(2) : '<span class="missing-data">N/A</span>'}</td>
        </tr>
      `;
    }
    
    html += `
          </tbody>
        </table>
      </div>
    `;
  }
  
  html += `
    </div>
    
    <script>
      function showTab(tabId) {
        // Hide all tabs
        const tabContents = document.getElementsByClassName('tab-content');
        for (let i = 0; i < tabContents.length; i++) {
          tabContents[i].classList.remove('active');
        }
        
        // Remove active class from all tab buttons
        const tabs = document.getElementsByClassName('tab');
        for (let i = 0; i < tabs.length; i++) {
          tabs[i].classList.remove('active');
        }
        
        // Show selected tab
        document.getElementById(tabId).classList.add('active');
        
        // Find and activate the tab button
        const buttons = document.getElementsByClassName('tab');
        for (let i = 0; i < buttons.length; i++) {
          if (buttons[i].getAttribute('onclick').includes(tabId)) {
            buttons[i].classList.add('active');
          }
        }
      }
    </script>
  </body>
  </html>
  `;
  
  return html;
}



module.exports = {
  processABFiles,
  combineRatesData,
  generateCombinedReport,
  TARGET_CODES
};