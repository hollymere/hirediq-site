const https = require('https');

function callClaude(API_KEY, prompt, maxTokens) {
  const requestBody = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: maxTokens,
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
            resolve({ ok: false, error: 'API error ' + res.statusCode + ': ' + data.substring(0, 300) });
            return;
          }
          const parsed = JSON.parse(data);
          let raw = parsed.content[0].text.trim();
          raw = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
          raw = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
          raw = raw.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-');
          JSON.parse(raw);
          resolve({ ok: true, body: raw });
        } catch(err) {
          resolve({ ok: false, error: 'Parse error: ' + err.message });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: 'Request error: ' + err.message });
    });

    req.write(requestBody);
    req.end();
  });
}

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

  const { jobDesc, cvContent, mode } = body;
  if (!jobDesc || !cvContent) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing job description or CV' }) };
  }

  // Trim inputs to prevent oversized requests
  const jd = jobDesc.substring(0, 3000);
  const cv = cvContent.substring(0, 3000);

  // COVER LETTER
  if (mode === 'cover_letter') {
    const prompt = `Write a tailored cover letter for this candidate for this role. ASCII characters only, no smart quotes or em dashes.

Respond ONLY with this JSON:
{"cover_letter": "<3-4 paragraph professional cover letter specific to this role>"}

JOB: ${jd}
CV: ${cv}

JSON only, no other text.`;

    const result = await callClaude(API_KEY, prompt, 1200);
    if (!result.ok) return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: result.error }) };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: result.body };
  }

  // CV REWRITE
  if (mode === 'rewrite') {
    const prompt = `Rewrite this CV for this specific role and provide 5 screening questions. ASCII characters only, no smart quotes or em dashes.

Respond ONLY with this JSON:
{
  "ats_optimised_cv": "<full ATS-optimised CV with missing keywords added naturally. Headers: Professional Summary, Work Experience, Education, Skills, Achievements only>",
  "cv_rewrite": "<full human-readable CV tailored for this role>",
  "screening_questions": [
    {"question": "<question>", "why_asked": "<one sentence>", "answer_framework": "<guidance>"}
  ]
}

Exactly 5 screening questions specific to this role and CV gaps.

JOB: ${jd}
CV: ${cv}

JSON only, no other text.`;

    const result = await callClaude(API_KEY, prompt, 2500);
    if (!result.ok) return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: result.error }) };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: result.body };
  }

  // ANALYSE (default)
  const prompt = `You are HiredIQ, built by a former MD with 30 years hiring experience. Be brutally honest. Do not inflate scores.

Respond ONLY with this JSON. ASCII characters only, no smart quotes or em dashes:
{
  "score": <0-100>,
  "verdict": "<Strong Candidate|Borderline|Do Not Apply>",
  "summary": "<2-3 sentences, direct and honest>",
  "requirements_met": [{"requirement": "<text>", "evidence": "<from CV>"}],
  "requirements_missing": [{"requirement": "<text>", "reason": "<why it matters>"}],
  "ats_keywords_present": ["<keyword from JD present in CV>"],
  "ats_keywords_missing": ["<keyword from JD missing from CV>"],
  "ats_warnings": ["<formatting issue that could cause ATS rejection>"],
  "salary_context": "<one sentence on typical pay for this role and location>",
  "salary_range_low": "<figure with currency>",
  "salary_range_high": "<figure with currency>"
}

Score: under 40 = Do Not Apply, 40-65 = Borderline, over 65 = Strong Candidate.

JOB: ${jd}
CV: ${cv}

JSON only, no other text.`;

  const result = await callClaude(API_KEY, prompt, 2000);
  if (!result.ok) return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: result.error }) };
  return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: result.body };
};
