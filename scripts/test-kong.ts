// Test Kong GraphQL API
const KONG_GRAPHQL_URL = 'https://kong.yearn.farm/graphql';

async function testKongAPI() {
  console.log('Testing Kong GraphQL API...');
  
  const query = `
    query TestQuery {
      vaults(chainId: 1) {
        chainId
        address
        name
        asset {
          address
          symbol
          name
          decimals
        }
      }
    }
  `;
  
  try {
    const response = await fetch(KONG_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    const text = await response.text();
    console.log('Response body:', text);
    
    if (response.ok) {
      const data = JSON.parse(text);
      console.log('First vault:', data.data?.vaults?.[0]);
      console.log('Total vaults:', data.data?.vaults?.length);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testKongAPI();