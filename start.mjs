// Runs the Ahuza Pay service instead of the store when AHUZA_PAY_ONLY=1 (set on the Ahuza Pay Railway service).
await import(process.env.AHUZA_PAY_ONLY === '1' ? './ahuza-pay/server.mjs' : './server-dist/server.js');
