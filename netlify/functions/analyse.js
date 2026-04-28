const https = require('https');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  const { jobDesc, cvContent } = body;
  if (!jobDesc || !cvContent) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing job description or CV' }) };
  }

  const prompt = `You are HiredIQ, an honest CV assessment tool built by a former MD with 30 years of hiring experience. Give candidates the complete honest truth about their application and prepare them for every stage of the process.

Analyse this job application and respond ONLY with valid JSON. Use only standard ASCII characters - no smart quotes, no em dashes, no special characters.

{
  "score": <number 0-100>,
  "verdict": "<one of: Strong Candidate, Borderline, Do Not Apply>",
  "summary": "<2-3 sentences of honest plain English assessment. Be direct and specific.>",
  "requirements_met": [
    {"requirement": "<requirement text>", "evidence": "<specific evidence from the CV>"}
  ],
  "requirements_missing": [
    {"requirement": "<requirement text>", "reason": "<why this gap matters to this employer>"}
  ],
  "ats_keywords_present": [
    "<exact keyword or phrase from job description that IS present in the CV>"
  ],
  "ats_keywords_missing": [
    "<exact keyword or phrase from job description that is NOT in the CV but should be>"
  ],
  "ats_warnings": [
    "<any formatting issue that could cause ATS rejection>"
  ],
  "ats_optimised_cv": "<full plain text ATS-optimised version of the CV. Naturally incorporate all missing keywords. Use standard section headers only: Professional Summary, Work Experience, Education, Skills, Achievements. No tables, no columns, no bullet symbols that ATS cannot read.>",
  "cv_rewrite": "<full polished human-readable version of the CV tailored for this specific role and company.>",
  "cover_letter": "<full cover letter for this specific role and company. Professional, specific, not generic.>",
  "screening_questions": [
    {
      "question": "<the specific question a recruiter would ask
