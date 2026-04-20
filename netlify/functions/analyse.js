exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'API key not configured' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { jobDesc, cvContent } = body;

  if (!jobDesc || !cvContent) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing job description or CV' }) };
  }

  const prompt = `You are HiredIQ, an honest CV assessment tool built by a former MD with 30 years of hiring experience. Your job is to give candidates the honest truth about their application, not flattery.

Analyse this job application and respond ONLY with valid JSON in exactly this structure:

{
  "score": <number 0-100>,
  "verdict": "<one of: Strong Candidate, Borderline, Do Not Apply>",
  "summary": "<2-3 sentences of honest plain English assessment>",
  "requirements_met": [
    {"requirement": "<requirement text>", "evidence": "<evidence from CV>"}
  ],
  "requirements_missing": [
    {"requirement": "<requirement text>", "reason": "<why this matters>"}
  ],
  "cv_rewrite": "<full rewritten CV tailored specifically for this role. Use the candidate real experience but frame it in the language and emphasis this employer is looking for. Include all standard CV sections.>",
  "cover_letter": "<a full cover letter written for this specific role and company. Professional, specific, not generic.>",
  "interview_questions": [
    "<likely interview question 1>",
    "<likely interview question 2>",
    "<likely interview question 3>"
  ],
  "salary_context": "<one sentence on what this role typically pays at this level in this location, based on the job description>",
  "salary_range_low": "<lower end figure with currency>",
  "salary_range_high": "<upper end figure with currency>"
}

Be genuinely honest. If the candidate is a poor fit, say so and explain why. Do not inflate scores. A score below 40 means Do Not Apply. 40-65 means Borderline. Above 65 means Strong Candidate.

JOB DESCRIPTION:
${jobDesc}

CANDIDATE CV:
${cvContent}

Respond with valid JSON only. No other text before or after.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: err.error?.message || 'API error' })
      };
    }

    const data = await response.json();
    const raw = data.content[0].text.trim();
    const jsonStr = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: jsonStr
    };

  } catch(err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
