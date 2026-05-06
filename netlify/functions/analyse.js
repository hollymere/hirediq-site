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

  const { jobDesc, cvContent, mode } = body;
  if (!jobDesc || !cvContent) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing job description or CV' }) };
  }

  const jd = jobDesc.substring(0, 3000);
  const cv = cvContent.substring(0, 3000);

  function makeRequest(prompt, maxTokens) {
    const requestBody = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
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
  }

  // COVER LETTER
  if (mode === 'cover_letter') {
    const prompt = `Write a tailored cover letter. ASCII only, no smart quotes or em dashes.
Respond ONLY with this JSON:
{"cover_letter": "<3-4 paragraph professional cover letter specific to this role>"}
JOB: ${jd}
CV: ${cv}
JSON only.`;
    return makeRequest(prompt, 1000);
  }

  // CV REWRITE - includes ATS keywords
  if (mode === 'rewrite') {
    const prompt = `Rewrite this CV for this role, identify ATS keywords, and give 5 screening questions. ASCII only, no smart quotes or em dashes.
Respond ONLY with this JSON:
{
  "ats_keywords_present": ["<keyword from JD present in CV>"],
  "ats_keywords_missing": ["<keyword from JD missing from CV>"],
  "ats_warnings": ["<ATS formatting issue>"],
  "ats_optimised_cv": "<full ATS CV with missing keywords added. Headers: Professional Summary, Work Experience, Education, Skills, Achievements>",
  "cv_rewrite": "<full human-readable CV tailored for this role>",
  "screening_questions": [{"question": "<q>", "why_asked": "<one sentence>", "answer_framework": "<guidance>"}]
}
Exactly 5 questions specific to this role and CV gaps.
JOB: ${jd}
CV: ${cv}
JSON only.`;
    return makeRequest(prompt, 2500);
  }

  // ANALYSE - score, verdict, requirements, salary only. Fast.
  const prompt = `You are HiredIQ, built by a former MD with 30 years hiring experience. Be honest, do not inflate scores. ASCII only, no smart quotes or em dashes.
Respond ONLY with this JSON:
{
  "score": <0-100>,
  "verdict": "<Strong Candidate|Borderline|Do Not Apply>",
  "summary": "<2-3 honest sentences>",
  "requirements_met": [{"requirement": "<text>", "evidence": "<from CV>"}],
  "requirements_missing": [{"requirement": "<text>", "reason": "<why it matters>"}],
  "salary_context": "<one sentence on typical pay>",
  "salary_range_low": "<figure with currency>",
  "salary_range_high": "<figure with currency>"
}
Score: under 40 = Do Not Apply, 40-65 = Borderline, over 65 = Strong Candidate.
JOB: ${jd}
CV: ${cv}
JSON only.`;

  return makeRequest(prompt, 1500);
};
