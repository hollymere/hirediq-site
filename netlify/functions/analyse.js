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
      "question": "<the specific question a recruiter would ask based on this role and CV>",
      "why_asked": "<one sentence on why recruiters ask this for this type of role>",
      "answer_framework": "<specific guidance on what to cover in the answer, what to emphasise and how to address any weakness this question might expose>"
    }
  ],
  "salary_context": "<one sentence on what this role typically pays at this level in this location>",
  "salary_range_low": "<lower salary figure with currency symbol>",
  "salary_range_high": "<upper salary figure with currency symbol>"
}

Scoring guide: below 40 means Do Not Apply. 40-65 means Borderline. Above 65 means Strong Candidate.

Generate exactly 5 screening questions. Make them specific to this actual job description and the candidate specific CV gaps, not generic interview questions.

JOB DESCRIPTION:
${jobDesc}

CANDIDATE CV:
${cvContent}

Respond with valid JSON only. No markdown, no code blocks, no other text before or after the JSON.`;

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }]
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            resolve({ statusCode: res.statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API error ' + res.statusCode + ': ' + data.substring(0, 300) }) });
            return;
          }
          const parsed = JSON.parse(data);
          let raw = parsed.content[0].text.trim();
          raw = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
          raw = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
          raw = raw.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-');
          JSON.parse(raw);
          resolve({ statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: raw });
        } catch(err) {
          resolve({ statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Parse error: ' + err.message }) });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Request error: ' + err.message }) });
    });

    req.write(requestBody);
    req.end();
  });
};
