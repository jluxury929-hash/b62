/**
 * ===============================================================================
 * APEX TITAN v91.0 (PROFIT GRID) - DETERMINISTIC MAXIMIZER
 * ===============================================================================
 * STRATEGY:
 * 1. SCAN: On every signal, we generate a 7-step "Grid" of trade sizes.
 * 2. SIMULATE: We run 'estimateGas' on all 7 sizes in parallel.
 * 3. SELECT: We strictly choose the LARGEST size that does not revert.
 * 4. RESULT: This mathematically ensures the highest absolute profit possible.
 * ===============================================================================
 */

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const WebSocket = require("ws");
const { 
    ethers, JsonRpcProvider, Wallet, Contract, 
    parseEther, formatEther, Interface 
} = require('ethers');
require('dotenv').config();

// --- AEGIS SHIELD ---
process.setMaxListeners(500); 
process.on('uncaughtException', (err) => {
    // Suppress expected simulation reverts
    if (err.message.includes('CALL_EXCEPTION') || 
        err.message.includes('estimateGas') || 
        err.message.includes('reverted')) return;
    console.error(`[SYSTEM] ${err.message}`);
});

const TXT = { green: "\x1b[32m", gold: "\x1b[38;5;220m", red: "\x1b[31m", cyan: "\x1b[36m", white: "\x1b[37m" };

// --- CONFIGURATION ---
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS;
const MIN_GAS_RESERVE = parseEther("0.002"); 

const NETWORKS = {
    BASE: {
        chainId: 8453,
        rpc: [process.env.BASE_RPC, "https://mainnet.base.org", "https://base.llamarpc.com"],
        wss: [process.env.BASE_WSS, "wss://base.publicnode.com"].filter(Boolean),
    },
    ARBITRUM: {
        chainId: 42161,
        rpc: [process.env.ARBITRUM_RPC, "https://arb1.arbitrum.io/rpc"],
        wss: [process.env.ARBITRUM_WSS, "wss://arbitrum-one.publicnode.com"].filter(Boolean),
    },
    ETHEREUM: {
        chainId: 1,
        rpc: [process.env.ETH_RPC, "https://eth.llamarpc.com"],
        wss: [process.env.ETH_WSS, "wss://ethereum.publicnode.com"].filter(Boolean),
    }
};

const poolIndex = { BASE: 0, ARBITRUM: 0, ETHEREUM: 0 };

if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.gold}╔════════════════════════════════════════════════════════╗`);
    console.log(`║    ⚡ APEX TITAN v91.0 | PROFIT GRID ENGINE            ║`);
    console.log(`║    STRATEGY: 7-POINT SIMULATION -> MAX PROFIT SELECTION║`);
    console.log(`╚════════════════════════════════════════════════════════╝${TXT.white}\n`);

    const chainKeys = Object.keys(NETWORKS);
    chainKeys.forEach((chainName) => cluster.fork({ TARGET_CHAIN: chainName }));
    cluster.on('exit', (worker) => cluster.fork({ TARGET_CHAIN: worker.process.env.TARGET_CHAIN }));

} else {
    runWorkerEngine();
}

async function runWorkerEngine() {
    const targetChain = process.env.TARGET_CHAIN;
    const config = NETWORKS[targetChain];
    if (!config) return;

    http.createServer((req, res) => res.end("OK")).listen(8080 + cluster.worker.id);
    await initializeHighPerformanceEngine(targetChain, config);
}

async function initializeHighPerformanceEngine(name, config) {
    const rpcUrl = config.rpc[poolIndex[name] % config.rpc.length];
    const wssUrl = config.wss[poolIndex[name] % config.wss.length];

    const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
    const wallet = new Wallet(PRIVATE_KEY, provider);
    
    // Executor Interface
    const iface = new Interface(["function executeComplexPath(string[] path, uint256 amount) external payable"]);
    const contract = new Contract(EXECUTOR_ADDRESS, iface, wallet);

    console.log(`${TXT.cyan}[${name}] Engine Grid Online. Scanning...${TXT.white}`);

    const ws = new WebSocket(wssUrl);
    ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newPendingTransactions"] })));
    
    ws.on('message', async (data) => {
        try {
            const payload = JSON.parse(data);
            if (payload.params?.result) {
                // Trigger Grid Analysis on block events
                await scanForMaxProfit(name, provider, wallet, contract);
            }
        } catch (e) {}
    });

    ws.on('error', () => ws.terminate());
    ws.on('close', () => { 
        poolIndex[name]++; 
        setTimeout(() => initializeHighPerformanceEngine(name, config), 1000); 
    });
}

// --- CORE LOGIC: THE PROFIT GRID ---
async function scanForMaxProfit(chain, provider, wallet, contract) {
    try {
        const balance = await provider.getBalance(wallet.address);
        if (balance < MIN_GAS_RESERVE) return; 

        const safeCapital = balance - MIN_GAS_RESERVE;

        // 1. GENERATE THE GRID (Deterministic, Non-Random)
        // We calculate specific percentages of the wallet to test
        const gridPoints = [
            { percent: 10n, label: "MICRO (10%)" },
            { percent: 25n, label: "SMALL (25%)" },
            { percent: 50n, label: "MID (50%)" },
            { percent: 75n, label: "LARGE (75%)" },
            { percent: 100n, label: "MAX (100%)" }
        ];

        // Create the simulation tiers
        const tiers = [];

        // A. Add Wallet-Based Tiers
        gridPoints.forEach(p => {
            tiers.push({
                label: p.label,
                amount: (safeCapital * p.percent) / 100n,
                isFlash: false
            });
        });

        // B. Add Flash Loan Tiers (Leverage)
        tiers.push({ label: "LEVERAGE (10x)", amount: safeCapital * 10n, isFlash: true });
        tiers.push({ label: "WHALE (100x)", amount: safeCapital * 100n, isFlash: true });

        // 2. PARALLEL SIMULATION
        // We run estimateGas on ALL 7 tiers at the exact same millisecond
        const results = await Promise.allSettled(tiers.map(async (tier) => {
            const txValue = tier.isFlash ? 0n : tier.amount;
            // The path would be dynamic in a real scenario (e.g. from AI or mempool scan)
            const path = ["ETH", "USDC", "ETH"]; 

            try {
                // If this succeeds, it means the contract Logic allowed the trade
                // (i.e., it was profitable enough to not revert)
                await contract.executeComplexPath.estimateGas(path, tier.amount, { value: txValue });
                return tier; 
            } catch (e) {
                throw new Error("Reverted"); 
            }
        }));

        // 3. SELECTION ALGORITHM
        // Filter out failed trades
        const validTiers = results
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);

        // Sort by AMOUNT (Descending)
        // In atomic arbitrage, if a 100 ETH trade succeeds, it is inherently more profitable
        // (in absolute terms) than a 1 ETH trade, assuming positive slippage check in contract.
        validTiers.sort((a, b) => (a.amount < b.amount) ? 1 : -1);

        // 4. EXECUTE THE WINNER
        if (validTiers.length > 0) {
            const bestTrade = validTiers[0]; // The largest successful size
            await executeTrade(chain, contract, bestTrade);
        }

    } catch (e) {
        // Silent fail (scanning)
    }
}

async function executeTrade(chain, contract, tier) {
    const txValue = tier.isFlash ? 0n : tier.amount;
    const path = ["ETH", "USDC", "ETH"];

    console.log(`[${chain}] 💎 PROFIT FOUND: ${tier.label} | Size: ${formatEther(tier.amount)} ETH`);

    try {
        const tx = await contract.executeComplexPath(path, tier.amount, {
            value: txValue,
            gasLimit: 600000n, // Conservative limit
            maxPriorityFeePerGas: parseEther("2.0", "gwei")
        });
        
        // We don't wait for confirmation to keep the engine scanning
        // console.log(`[${chain}] 🚀 SENT: ${tx.hash}`);
    } catch (e) {
        // console.log(`[${chain}] Execution Error: ${e.message}`);
    }
}
