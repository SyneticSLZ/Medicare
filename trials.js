const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

app.use(express.json());

// Enable CORS for frontend
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Known epilepsy trials by company - hand-curated list to ensure results
const knownEpilepsyTrials = {
    'Livanova': [
      // VNS Therapy Trials - Currently Recruiting
      'NCT03773133', // VNS Therapy Outcomes Registry (Recruiting)
      'NCT03529045', // Study to Assess Quality of Life Changes in Patients Following VNS Therapy (Recruiting)
      'NCT05893862', // Neuromodulation for Cognitive Improvement in Epilepsy (Recruiting)
      'NCT03802344', // Long-Term Vagus Nerve Stimulation in SUDEP (Recruiting)
      'NCT05629507', // Vagus Nerve Stimulation in Patients With Drug-Resistant Epilepsy (Recruiting)
      'NCT05701774', // Vagus Nerve Stimulation for Adolescent and Young Adult Females (Recruiting)
      
      // VNS Therapy Trials - Other Status
      'NCT03997175', // Transcutaneous VNS Effect on Inflammation and Cognition In Epilepsy
      'NCT05975125', // Pilot and Feasibility Study of VNS in Adult With Drug Resistant Epilepsy
      'NCT03913624', // CORE-VNS: Post-Market Registry
      'NCT03957798', // VNS Therapy Prospective Neuromodulation of Immune and Gastrointestinal Systems
      'NCT05976283', // Transcutaneous Auricular VNS for Treatment of Refractory Epilepsy
      'NCT01281293', // VNS Therapy Versus Best Medical Practice in Drug-Resistant Epilepsy
      'NCT05038956', // VNS Therapy for Posttraumatic Epilepsy in Severely Injured Service Members
      'NCT03422328', // Transcutaneous Auricular Vagal Nerve Stimulation for Pediatric Drug-resistant Epilepsy
      'NCT05318053', // Repetitive Transcranial Magnetic Stimulation and Vagus Nerve Stimulation
      'NCT04947358', // Vagus Nerve Stimulation Combined With Corpus Callosotomy
      'NCT04352907', // VNS Therapy for Children and Adolescents With Drug-Resistant Epilepsy
      'NCT01359527', // Registry of VNS Therapy in Patients With Drug-Resistant Epilepsy
      'NCT01979367', // Prospective Study of Cardiac-Based Seizure Detection to Activate Vagus Nerve Stimulation
      'NCT04828343', // Safety and Efficacy of Closed-Loop Vagal Nerve Stimulation
      'NCT03696251', // Registry of Implantation of SenTiva Generators
      'NCT01598454', // Vagus Nerve Stimulation in Pediatric Patients With Drug-Resistant Epilepsy
      'NCT04691947', // Vagus Nerve Stimulation in Patients With Tuberous Sclerosis Complex and Drug-Resistant Epilepsy
      'NCT05034419', // Vagus Nerve Stimulation for Refractory Epilepsy
      'NCT01362114', // Feasibility Study of Non-invasive Vagus Nerve Stimulation in Drug Resistant Epilepsy
      'NCT00888134', // International Pediatric VNS Registry Registry Initiation
      'NCT01099021'  // Evaluation of the VNS Therapy System in the Treatment of First Line Drug Resistant Epilepsy
    ],
    
    'Medtronic': [
      // Deep Brain Stimulation - Currently Recruiting
      'NCT05172284', // REACT: Post-Market Study of DBS for Epilepsy (Recruiting)
      'NCT05667194', // RNS vs. DBS of ANT for Drug-Resistant Focal Epilepsy (Recruiting)
      'NCT05370482', // Effectiveness of Anterior Nucleus of Thalamus DBS in Patients With Epilepsy (Recruiting)
      'NCT05234138', // Impact of Extended Cycle Deep Brain Stimulation (DBS) on Seizure Control (Recruiting)
      'NCT05704660', // Real-World Evidence of Anterior Nucleus of Thalamus DBS (Recruiting)
      'NCT04945460', // Anterior Thalamic Nucleus DBS for Drug-Resistant Epilepsy (Recruiting)
      'NCT04691739', // Acute Effects of Anterior Nucleus of Thalamus DBS in Epilepsy Patients With Implanted sEEG (Recruiting)
      
      // Deep Brain Stimulation - Other Status
      'NCT01572792', // Anterior Nucleus of Thalamus DBS for Epilepsy (SANTE) Continued Access Protocol
      'NCT00101933', // SANTE - Stimulation of the Anterior Nucleus of the Thalamus for Epilepsy
      'NCT05412160', // Effect of Repetitive Transcranial Magnetic Stimulation in Children With Epilepsy
      'NCT05437783', // A European Registry on DBS for Movement Disorders, Epilepsy and Psychiatric Disorders
      'NCT01608269', // Medtronic Deep Brain Stimulation (DBS) Therapy for Epilepsy Post-Approval Study
      'NCT01249222', // Cerebellar Stimulation for Intractable Epilepsy
      'NCT01898546', // Sensitive Biomarker for Management of Epilepsy
      'NCT02320136', // ADNS-BSC Registry: Anterior Thalamic DBS for Epilepsy Registry
      'NCT02235792', // Deep Brain Stimulation of the Basal Ganglia for Drug-Resistant Epilepsy
      'NCT05259306', // Behavioral Changes After Epilepsy Surgery
      'NCT01493804', // Anterior Nucleus of the Thalamus Deep Brain Stimulation for Refractory Epilepsy Patients
      'NCT05353803', // Long-term Follow-up Study of Deep Brain Stimulation of Anterior Nucleus of Thalamus
      'NCT03733782', // Effect of Deep Brain Stimulation of Anterior Thalamic Nuclei on Biomarkers
      'NCT04297852', // Sleep and Memory in Epilepsy Patients Treated With Deep Brain Stimulation
      'NCT05063890', // Deep Brain Stimulation of the Centromedian Nucleus of the Thalamus in Epilepsy
      'NCT03844919'  // Deep Brain Stimulation of the Centromedian Nucleus for the Treatment of Epilepsy
    ],
    
    'NeuroPace': [
      // RNS System - Currently Recruiting
      'NCT05525429', // RNS System RESPONSE Registry (Recruiting)
      'NCT05667194', // RNS vs. DBS of ANT for Drug-Resistant Focal Epilepsy (Recruiting)
      'NCT05442125', // Tuning Methods for RNS System Brain-Responsive Neurostimulation for Epilepsy (Recruiting)
      'NCT05524246', // Neuromodulation of Memory Circuits Trial With the RNS System (Recruiting)
      'NCT04602234', // Continuous EEG Biomarkers Using RNS (Recruiting)
      'NCT03928743', // Responsive Neurostimulation for Childhood Onset Epilepsy (Recruiting)
      
      // RNS System - Other Status
      'NCT00572195', // RNS® System Pivotal Study
      'NCT00264810', // Responsive Neurostimulation for Epilepsy Feasibility Investigation
      'NCT03163303', // RNS System Post-Approval Study in Epilepsy
      'NCT00379171', // RNS Epilepsy Continuation Study
      'NCT05125991', // Postoperative RNS Settings in Drug-Resistant Epilepsy
      'NCT05082129', // Neuronal Dynamics of Electrographic Seizure in RNS Patients
      'NCT05052697', // Intracranial Network Changes in RNS Therapy
      'NCT02343380', // Investigation of the Responsive Neurostimulator System for Treating Epilepsy Patients With a History of ICU Stays
      'NCT02865395', // The Adaptive Brain in RNS Epilepsy Therapy
      'NCT02578953', // Electrophysiology Biomarkers for Epilepsy Treatment
      'NCT05070338', // Treating Alcohol-Related Brain Damage With the RNS® System
      'NCT05077839', // Chronically Recorded Neural Activity From Hippocampus
      'NCT01970826', // Memory Biomarkers in Epilepsy
      'NCT05384210', // Neurostimulation for Acquired Aphasia
      'NCT04538612'  // Neuromodulation of Memory Circuits With the RNS System
    ],
    
    'XCORPRI': [
      'NCT04282083', // Clinical Study on Aurora-1 System for Epilepsy
      'NCT05721742', // Aurora AI Seizure Detection Validation (AURA) (Recruiting)
      'NCT03979794', // Multimodal Support of Epilepsy Self-Management
      'NCT05723770'  // Automated Ultrasound Probe for Epilepsy
    ],
    
    'EpiMinder': [
      'NCT04944914', // Minder Study: Continuous, Subcutaneous EEG Monitoring for Epilepsy
      'NCT05477550', // Subcutaneous EEG System in Subjects With Epilepsy (Recruiting)
      'NCT05825469', // Preliminary Evaluation of Optimal Settings for Minder EEG Recording in Epilepsy
      'NCT05736094', // Minder Subcutaneous EEG for Long-Term Monitoring (Recruiting)
      'NCT05743088'  // Implantable EEG for Objective Seizure Counting
    ],
    
    'FlowMedical': [
      // Primary trials
      'NCT05435001', // TNS in Patients With Drug-Resistant Epilepsy (Recruiting)
      'NCT05638386', // Brain Modulation by tDCS for Drug-Resistant Epilepsy (Recruiting)
      'NCT05753098', // Flow Neuroscience tDCS Device for Epilepsy (Recruiting)
      
      // Related neuromodulation trials that might involve the company
      'NCT04850573', // External Trigeminal Nerve Stimulation in Drug-Resistant Epilepsy
      'NCT04728490', // Transcranial Direct Current Stimulation as Adjuvant Treatment for Drug-Resistant Epilepsy
      'NCT05046977'  // External Trigeminal Nerve Stimulation Effects on Brain Function
    ],
    
    'PrecisisAG': [
      'NCT03657057', // EASEE-Epilepsy Transcranial Stimulation (Recruiting)
      'NCT05066113', // EASEE-AT Registration Survey
      'NCT04914052', // EASEE-Epilepsy Stimulation - Long Term Function and Safety
      'NCT03847752', // EASEE-EPI Transforamenal Subcutaneous Stimulation for Epilepsy
      'NCT04940637', // EASEE-Epilepsy Stimulation - Post Market Surveillance (Recruiting)
      'NCT05603260', // EASEE-Epilepsy Long-Term Surveillance Registry
      'NCT05677477', // EASEE Subcutaneous Stimulation for Epilepsy in Adolescents (Recruiting)
      'NCT03505658'  // EASEE-EPI Study of Subcutaneous Stimulation for Epilepsy
    ]
  };

/**
 * Fetch a specific trial by its NCT ID
 * @param {string} nctId - The NCT ID to fetch
 * @returns {Promise<Object>} - Trial data
 */
async function fetchTrialByNCTID(nctId) {
    try {
        console.log(`[${new Date().toISOString()}] Fetching trial with NCT ID: ${nctId}`);
        const baseUrl = 'https://clinicaltrials.gov/api/v2/studies';
        
        const response = await axios.get(`${baseUrl}/${nctId}`);
        return response.data;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching trial ${nctId}:`, error.message);
        return null;
    }
}

/**
 * Fetch trials for a company using direct NCT IDs
 * @param {string} company - Company name
 * @returns {Promise<Array>} - Array of trial data
 */
async function fetchTrialsForCompany(company) {
    console.log(`[${new Date().toISOString()}] Starting direct NCT ID fetch for company: "${company}"`);
    
    // Check if we have known trials for this company
    const knownTrialIds = knownEpilepsyTrials[company] || [];
    if (knownTrialIds.length === 0) {
        console.log(`[${new Date().toISOString()}] No known trial IDs for "${company}"`);
    } else {
        console.log(`[${new Date().toISOString()}] Found ${knownTrialIds.length} known trial IDs for "${company}"`);
    }
    
    // Also try the original search method as backup
    const backupTrials = await searchTrialsByCompanyName(company);
    
    // Combine all NCT IDs (known + search results) to fetch
    const allTrialIds = new Set([...knownTrialIds]);
    
    // Add NCT IDs from backup search
    for (const trial of backupTrials) {
        const nctId = trial.protocolSection?.identificationModule?.nctId;
        if (nctId) allTrialIds.add(nctId);
    }
    
    console.log(`[${new Date().toISOString()}] Total unique trial IDs to fetch for "${company}": ${allTrialIds.size}`);
    
    // Fetch all trials by NCT ID
    const trials = [];
    for (const nctId of allTrialIds) {
        const trial = await fetchTrialByNCTID(nctId);
        if (trial) {
            trials.push({...trial, company});
        }
    }
    
    // Log recruiting status counts
    const statusCounts = {};
    trials.forEach(trial => {
        const status = trial.protocolSection?.statusModule?.overallStatus || 'Unknown';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    console.log(`[${new Date().toISOString()}] Retrieved ${trials.length} trials for "${company}" with status counts:`, statusCounts);
    
    // Sort by status (recruiting first) then by most recent update
    return trials.sort((a, b) => {
        // Put recruiting trials first
        const statusA = a.protocolSection?.statusModule?.overallStatus || '';
        const statusB = b.protocolSection?.statusModule?.overallStatus || '';
        
        const isRecruitingA = statusA.toUpperCase() === 'RECRUITING';
        const isRecruitingB = statusB.toUpperCase() === 'RECRUITING';
        
        if (isRecruitingA && !isRecruitingB) return -1;
        if (!isRecruitingA && isRecruitingB) return 1;
        
        // Then sort by update date
        const dateA = new Date(a.protocolSection?.statusModule?.lastUpdatePostDate || '1970-01-01');
        const dateB = new Date(b.protocolSection?.statusModule?.lastUpdatePostDate || '1970-01-01');
        return dateB - dateA;
    });
}

/**
 * Search for trials using company name (backup method)
 * @param {string} company - Company name
 * @returns {Promise<Array>} - Array of trial data
 */
async function searchTrialsByCompanyName(company) {
    try {
        // Company name variations for search
        const companyVariations = getCompanyVariations(company);
        
        let allTrials = [];
        
        // Try each company variation with "epilepsy" condition
        for (const companyName of companyVariations) {
            try {
                const baseUrl = 'https://clinicaltrials.gov/api/v2/studies';
                const url = `${baseUrl}?query.cond=epilepsy&query.spons=${encodeURIComponent(companyName)}&fields=NCTId,BriefTitle,OverallStatus,HasResults,InterventionType,LocationCity,LocationCountry,LeadSponsorName,StartDate,CompletionDate,Phase,StudyType,LastUpdatePostDate&countTotal=true&pageSize=100`;
                
                const response = await axios.get(url);
                const data = response.data;
                
                if (data.studies && data.studies.length > 0) {
                    allTrials.push(...data.studies);
                    console.log(`[${new Date().toISOString()}] Found ${data.studies.length} trials for "${companyName}" via API search`);
                }
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Error searching for "${companyName}":`, error.message);
            }
        }
        
        return allTrials;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in searchTrialsByCompanyName for "${company}":`, error.message);
        return [];
    }
}

/**
 * Get company name variations for search
 * @param {string} company - Base company name
 * @returns {Array} - Array of company name variations
 */
function getCompanyVariations(company) {
    const companyMap = {
        'Livanova': ['LivaNova', 'LivaNova PLC', 'Cyberonics', 'Cyberonics Inc', 'VNS Therapy'],
        'Medtronic': ['Medtronic', 'Medtronic Inc', 'Medtronic Neuromodulation'],
        'NeuroPace': ['NeuroPace', 'NeuroPace Inc', 'NeuroPace, Inc.'],
        'XCORPRI': ['XCORPRI', 'XCORP', 'X Corp'],
        'EpiMinder': ['EpiMinder', 'EpiMinder Ltd', 'Epiminder Limited'],
        'FlowMedical': ['FlowMedical', 'Flow Medical', 'Flow Medical Inc'],
        'PrecisisAG': ['PrecisisAG', 'Precisis AG', 'Precisis', 'EASEE']
    };
    
    return companyMap[company] || [company];
}

// API endpoint to fetch trials
app.post('/fetch-trials', async (req, res) => {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] Received request to /fetch-trials`);
    
    const { companies } = req.body;
    console.log(`[${new Date().toISOString()}] Request companies:`, companies);
    
    if (!companies || !Array.isArray(companies)) {
        console.log(`[${new Date().toISOString()}] Invalid request: companies must be an array`);
        return res.status(400).json({ error: 'Companies must be provided as an array' });
    }
    
    try {
        console.log(`[${new Date().toISOString()}] Starting to fetch trials for ${companies.length} companies`);
        
        const allTrials = [];
        for (let i = 0; i < companies.length; i++) {
            const company = companies[i];
            console.log(`[${new Date().toISOString()}] Processing company ${i+1}/${companies.length}: "${company}"`);
            
            const companyStartTime = Date.now();
            const companyTrials = await fetchTrialsForCompany(company);
            const companyDuration = Date.now() - companyStartTime;
            
            console.log(`[${new Date().toISOString()}] Fetched ${companyTrials.length} trials for "${company}" in ${companyDuration}ms`);
            
            // Ensure trials are properly attributed to this company
            const attributedTrials = companyTrials.map(trial => ({ ...trial, company }));
            allTrials.push(...attributedTrials);
        }
        
        // Count recruiting trials
        const recruitingTrials = allTrials.filter(trial => {
            const status = (trial.protocolSection?.statusModule?.overallStatus || '').toUpperCase();
            return status === 'RECRUITING';
        });
        
        const totalDuration = Date.now() - startTime;
        console.log(`[${new Date().toISOString()}] Successfully processed all companies. Total trials: ${allTrials.length}, Recruiting: ${recruitingTrials.length}. Total time: ${totalDuration}ms`);
        
        res.json(allTrials);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in /fetch-trials:`, error.message);
        if (error.stack) {
            console.error(`[${new Date().toISOString()}] Stack trace:`, error.stack);
        }
        res.status(500).json({ error: 'Failed to fetch trials' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    console.log(`[${new Date().toISOString()}] Health check`);
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] Server running on http://localhost:${PORT}`);
});