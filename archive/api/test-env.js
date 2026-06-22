// api/test-env.js
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  
  // Return environment variable status
  const key = process.env.SIGNFORGE_API_KEY;
  res.status(200).json({
    keyExists: !!key,
    keyValue: key || 'not set',
    keyLength: key ? key.length : 0,
    keyPrefix: key ? key.substring(0, 10) : 'none',
    allApiKeys: Object.keys(process.env).filter(k => 
      k.includes('SIGNFORGE') || k.includes('API') || k.includes('KEY')
    )
  });
}