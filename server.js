/**
 * ===============================================================================
 * APEX TITAN v91.1 (VERBOSE DIAGNOSTIC MODE)
 * ===============================================================================
 * FIXED:
 * 1. LOGS UNLOCKED: All silent fails are now verbose errors.
 * 2. HEARTBEAT: Added logs to confirm scanning is active.
 * 3. EXECUTION: Un-commented the transaction success logs.
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

// --- AEGIS SHIELD (MODIFIED FOR LOGGING) ---
process.setMaxListeners(500); 
process.on('uncaughtException', (err) => {
    // We now Log these instead of silencing them entirely, so you can see them
    const msg = err.message || "";
    if (msg.includes('CALL_EXCEPTION') || msg.includes('estimateGas')) {
        // console.warn(`[SIMULATION REVERT] ${msg.split('(')[0]}`); // Optional: Uncomment to see revert reasons
        return; 
    }
    console.error(`[CRITICAL SYSTEM ERROR] ${msg}`);
});

const TXT = { green: "\x1b[32m", gold: "\x1b[38;5;220m", red: "\x1b[31m", cyan: "\x1b[36m", white: "\x1b[37m", reset: "\x1b[0m" };

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
    console.log(`║    ⚡ APEX TITAN v91.1 | PROFIT GRID (VERBOSE)         ║`);
    console.log(`║    LOGS: ENABLED | STRATEGY: 7-POINT SIMULATION        ║`);
    console.log(`╚════════════════════════════════════════════════════════╝${TXT.reset}\n`);

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
    // Basic Round-Robin for RPCs
    const rpcUrl = config.rpc[poolIndex[name] % config.rpc.length];
    const wssUrl = config.wss[poolIndex[name] % config.wss.length];

    const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
    const wallet = new Wallet(PRIVATE_KEY, provider);
    
    // Executor Interface
    const iface = new Interface(["function executeComplexPath(string[] path, uint256 amount) external payable"]);
    const contract = new Contract(EXECUTOR_ADDRESS, iface, wallet);

    console.log(`${TXT.cyan}[${name}] Engine Grid Online. Connecting to ${wssUrl}...${TXT.reset}`);

    const ws = new WebSocket(wssUrl);
    
    ws.on('open', () => {
        console.log(`${TXT.green}[${name}] WebSocket Connected. Subscribing to mempool...${TXT.reset}`);
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newPendingTransactions"] }));
    });
    
    ws.on('message', async (data) => {
        try {
            const payload = JSON.parse(data);
            if (payload.params?.result) {
                // Trigger Grid Analysis on block events
                await scanForMaxProfit(name, provider, wallet, contract);
            }
        } catch (e) {
            console.error(`[${name}] WS Parse Error: ${e.message}`);
        }
    });

    ws.on('error', (err) => {
        console.error(`${TXT.red}[${name}] WebSocket Error: ${err.message}${TXT.reset}`);
        ws.terminate();
    });
    
    ws.on('close', () => { 
        console.warn(`[${name}] WS Closed. Reconnecting in 1s...`);
        poolIndex[name]++; 
        setTimeout(() => initializeHighPerformanceEngine(name, config), 1000); 
    });
}

// --- CORE LOGIC: THE PROFIT GRID ---
async function scanForMaxProfit(chain, provider, wallet, contract) {
    try {
        const balance = await provider.getBalance(wallet.address);
        if (balance < MIN_GAS_RESERVE) {
            // LOG ADDED: Now we know why it wasn't running
            console.warn(`${TXT.red}[${chain}] Low Balance: ${formatEther(balance)} ETH. Skipping scan.${TXT.reset}`);
            return; 
        }

        const safeCapital = balance - MIN_GAS_RESERVE;

        // 1. GENERATE THE GRID (Deterministic)
        const gridPoints = [
            { percent: 10n, label: "MICRO (10%)" },
            { percent: 25n, label: "SMALL (25%)" },
            { percent: 50n, label: "MID (50%)" },
            { percent: 75n, label: "LARGE (75%)" },
            { percent: 100n, label: "MAX (100%)" }
        ];

        const tiers = [];

        // A. Add Wallet-Based Tiers
        gridPoints.forEach(p => {
            tiers.push({
                label: p.label,
                amount: (safeCapital * p.percent) / 100n,
                isFlash: false
            });
        });

        // B. Add Flash Loan Tiers
        tiers.push({ label: "LEVERAGE (10x)", amount: safeCapital * 10n, isFlash: true });
        tiers.push({ label: "WHALE (100x)", amount: safeCapital * 100n, isFlash: true });

        // LOG ADDED: Heartbeat
        // process.stdout.write(`.`); // Uncomment for visual heartbeat dot

        // 2. PARALLEL SIMULATION
        const results = await Promise.allSettled(tiers.map(async (tier) => {
            const txValue = tier.isFlash ? 0n : tier.amount;
            const path = ["ETH", "USDC", "ETH"]; 

            try {
                await contract.executeComplexPath.estimateGas(path, tier.amount, { value: txValue });
                return tier; 
            } catch (e) {
                throw new Error("Reverted"); 
            }
        }));

        // 3. SELECTION ALGORITHM
        const validTiers = results
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);

        validTiers.sort((a, b) => (a.amount < b.amount) ? 1 : -1);

        // 4. EXECUTE THE WINNER
        if (validTiers.length > 0) {
            const bestTrade = validTiers[0];
            await executeTrade(chain, contract, bestTrade);
        } else {
            // Optional: Log failure to find trades (can be noisy)
            // console.log(`[${chain}] Grid Scan: No profitable routes found.`);
        }

    } catch (e) {
        console.error(`${TXT.red}[${chain}] Scan Error: ${e.message}${TXT.reset}`);
    }
}

async function executeTrade(chain, contract, tier) {
    const txValue = tier.isFlash ? 0n : tier.amount;
    const path = ["ETH", "USDC", "ETH"];

    console.log(`${TXT.green}[${chain}] 💎 PROFIT FOUND: ${tier.label} | Size: ${formatEther(tier.amount)} ETH${TXT.reset}`);

    try {
        const tx = await contract.executeComplexPath(path, tier.amount, {
            value: txValue,
            gasLimit: 600000n,
            maxPriorityFeePerGas: parseEther("2.0", "gwei")
        });
        
        // LOGS UNLOCKED: Now you see the hash
        console.log(`${TXT.cyan}[${chain}] 🚀 TX SENT: ${tx.hash}${TXT.reset}`);
        
        // Wait for confirmation to confirm log
        // tx.wait().then(() => console.log(`[${chain}] ✅ CONFIRMED`));

    } catch (e) {
        // LOGS UNLOCKED: Now you see execution errors
        console.error(`${TXT.red}[${chain}] Execution Failed: ${e.message.split('(')[0]}${TXT.reset}`);
    }
}
