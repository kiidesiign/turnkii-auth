// api/airtable-tables.js
import Airtable from 'airtable';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.turnkii.es');
  
  try {
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
      .base(process.env.AIRTABLE_BASE_ID);
    
    // This is a hack to get table names - Airtable doesn't have a direct API for this
    // So we'll try a few common table names
    const possibleTables = ['Contacts', 'contacts', 'Table 1', 'Contact', 'contact', 'Users', 'users'];
    const results = [];
    
    for (const tableName of possibleTables) {
      try {
        const records = await base(tableName).select({ maxRecords: 1 }).firstPage();
        results.push({ 
          tableName, 
          exists: true, 
          recordCount: records.length 
        });
      } catch (err) {
        if (err.message.includes('Could not find')) {
          results.push({ tableName, exists: false });
        } else {
          results.push({ tableName, exists: 'error', error: err.message });
        }
      }
    }
    
    // Also show your current environment variable
    const configuredTable = process.env.AIRTABLE_TABLE_NAME;
    
    return res.status(200).json({
      message: 'Table discovery results',
      configuredTable: configuredTable || '(not set)',
      baseId: process.env.AIRTABLE_BASE_ID,
      results
    });
    
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}