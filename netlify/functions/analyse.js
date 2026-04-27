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

  const prompt = `You are HiredIQ, an honest CV assessment tool. Analyse this job application and respond ONLY with valid JSON. Use only standard ASCII characters - no smart quotes, no em dashes, no special characters.\n\n{"score": <0-100>, "verdict": "<Strong Candidate, Borderline, or Do Not Apply>", "summary": "<2-3 honest sentences>", "requirements_met": [{"requirement": "<text>", "evidence": "<from CV>"}], "requirements_missing": [{"requirement": "<text>", "reason": "<why it matters>"}], "cv_rewrite": "<full rewritten CV for this role>", "cover_letter": "<full cover letter>", "interview_questions": ["<q1>", "<q2>", "<q3>"], "salary_context": "<one sentence on typical pay>", "salary_range_low": "<figure>", "salary_range_high": "<figure>"}\n\nScore below 40 = Do Not Apply. 40-65 = Borderline. Above 65 = Strong Candidate.\n\nJOB DESCRIPTION:\n${jobDesc}\n\nCANDIDATE CV:\n${cvContent}\n\nJSON only. No markdown. No other text.`;

  const requestBody = JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(requestBody) }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            resolve({ statusCode: res.statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'API error ' + res.statusCode }) });
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
