/**
 * Price Converter Service
 *
 * Converts crypto amounts to USD using CoinGecko API
 *
 * Methodology:
 * 1. Fetches historical prices at transaction timestamp
 * 2. Caches prices to minimize API calls
 * 3. Maps currencies to CoinGecko IDs
 * 4. Handles stablecoins specially (USDC = $1.00)
 */

// CoinGecko API configuration
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY; // Optional API key for higher rate limits
const PRICE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

// Currency to CoinGecko ID mapping
const CURRENCY_TO_COINGECKO_ID: Record<string, string> = {
    'XRP': 'ripple',
    'ETH': 'ethereum',
    'FLR': 'flare-networks',
    'FXRP': 'ripple', // FXRP tracks XRP price
    'USDC': 'usd-coin', // Stablecoin, but fetch real price for accuracy
};

interface PriceCacheEntry {
    priceUsd: number;
    timestamp: number;
    expiresAt: number;
}

// In-memory price cache
const priceCache = new Map<string, PriceCacheEntry>();

/**
 * Get current USD price for a currency
 * Uses CoinGecko simple/price endpoint
 */
async function getCurrentPrice(currency: string): Promise<number> {
    // Special cases: USD and stablecoins
    if (currency === 'USD' || currency === 'USDC') {
        return 1.0;
    }

    const coinId = CURRENCY_TO_COINGECKO_ID[currency];
    if (!coinId) {
        throw new Error(`Unknown currency: ${currency}. Cannot convert to USD.`);
    }

    // Check cache first
    const cacheKey = `current_${coinId}`;
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
        return cached.priceUsd;
    }

    try {
        const params = new URLSearchParams({
            ids: coinId,
            vs_currencies: 'usd'
        });
        // Add API key if available
        if (COINGECKO_API_KEY) {
            params.set('x_cg_demo_api_key', COINGECKO_API_KEY);
        }
        const response = await fetch(`${COINGECKO_API_BASE}/simple/price?${params}`);

        if (!response.ok) {
            throw new Error(`CoinGecko API returned ${response.status}`);
        }

        const data = await response.json();
        const priceUsd = data[coinId]?.usd;
        if (typeof priceUsd !== 'number') {
            throw new Error(`Failed to get USD price for ${currency} (${coinId})`);
        }

        // Cache the price
        priceCache.set(cacheKey, {
            priceUsd,
            timestamp: Date.now(),
            expiresAt: Date.now() + PRICE_CACHE_TTL_MS
        });

        return priceUsd;
    } catch (error: any) {
        throw new Error(`CoinGecko API error for ${currency}: ${error.message}`);
    }
}

/**
 * Get historical USD price for a currency at a specific timestamp
 * Uses CoinGecko coins/{id}/history endpoint
 *
 * Note: Historical data has daily granularity (not minute-level)
 * For recent transactions (<5 min old), use current price for better accuracy
 */
async function getHistoricalPrice(currency: string, timestampMs: number): Promise<number> {
    // Special cases: USD and stablecoins
    if (currency === 'USD' || currency === 'USDC') {
        return 1.0;
    }

    const coinId = CURRENCY_TO_COINGECKO_ID[currency];
    if (!coinId) {
        throw new Error(`Unknown currency: ${currency}. Cannot convert to USD.`);
    }

    const now = Date.now();
    const ageMs = now - timestampMs;

    // For very recent transactions (< 5 minutes), use current price
    // This is more accurate than daily historical data
    if (ageMs < 5 * 60 * 1000) {
        return getCurrentPrice(currency);
    }

    // Convert timestamp to date string (DD-MM-YYYY format)
    const date = new Date(timestampMs);
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    const dateStr = `${day}-${month}-${year}`;

    // Check cache
    const cacheKey = `historical_${coinId}_${dateStr}`;
    const cached = priceCache.get(cacheKey);
    if (cached) {
        return cached.priceUsd;
    }

    try {
        const params = new URLSearchParams({
            date: dateStr,
            localization: 'false'
        });
        // Add API key if available
        if (COINGECKO_API_KEY) {
            params.set('x_cg_demo_api_key', COINGECKO_API_KEY);
        }
        const response = await fetch(`${COINGECKO_API_BASE}/coins/${coinId}/history?${params}`);

        if (!response.ok) {
            throw new Error(`CoinGecko API returned ${response.status}`);
        }

        const data = await response.json();
        const priceUsd = data.market_data?.current_price?.usd;
        if (typeof priceUsd !== 'number') {
            console.warn(`No historical price for ${currency} on ${dateStr}, falling back to current price`);
            return getCurrentPrice(currency);
        }

        // Cache historical prices (they don't expire)
        priceCache.set(cacheKey, {
            priceUsd,
            timestamp: timestampMs,
            expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 // Cache for 1 year
        });

        return priceUsd;
    } catch (error: any) {
        console.warn(`Failed to get historical price for ${currency} on ${dateStr}: ${error.message}`);
        console.warn('Falling back to current price');
        return getCurrentPrice(currency);
    }
}

/**
 * Convert a crypto amount to USD
 *
 * @param amount - Amount in native currency
 * @param currency - Currency code (XRP, ETH, FLR, USDC, FXRP)
 * @param timestampMs - Transaction timestamp in milliseconds (optional, uses current time if not provided)
 * @returns USD value rounded to 2 decimal places
 */
export async function convertToUsd(
    amount: number,
    currency: string,
    timestampMs?: number
): Promise<number> {
    if (amount === 0) return 0;

    const normalizedCurrency = currency.toUpperCase();

    try {
        let priceUsd: number;

        if (timestampMs) {
            priceUsd = await getHistoricalPrice(normalizedCurrency, timestampMs);
        } else {
            priceUsd = await getCurrentPrice(normalizedCurrency);
        }

        const usdValue = amount * priceUsd;

        // Round to 8 decimal places to capture even very small fees
        // This ensures fees like $0.00000123 don't get rounded to $0.00
        return Math.round(usdValue * 100000000) / 100000000;
    } catch (error: any) {
        console.error(`Failed to convert ${amount} ${currency} to USD: ${error.message}`);
        throw error;
    }
}

/**
 * Batch convert multiple amounts to USD
 * More efficient when converting multiple currencies at once
 *
 * @param conversions - Array of {amount, currency, timestamp} objects
 * @returns Array of USD values in the same order
 */
export async function batchConvertToUsd(
    conversions: Array<{ amount: number; currency: string; timestampMs?: number }>
): Promise<number[]> {
    const results = await Promise.all(
        conversions.map(({ amount, currency, timestampMs }) =>
            convertToUsd(amount, currency, timestampMs)
        )
    );
    return results;
}

/**
 * Get current exchange rates for all supported currencies
 * Useful for displaying current prices in UI
 */
export async function getCurrentExchangeRates(): Promise<Record<string, number>> {
    const currencies = Object.keys(CURRENCY_TO_COINGECKO_ID);
    const rates: Record<string, number> = {};

    for (const currency of currencies) {
        try {
            rates[currency] = await getCurrentPrice(currency);
        } catch (error) {
            console.warn(`Failed to get rate for ${currency}`);
            rates[currency] = 0;
        }
    }

    return rates;
}

/**
 * Clear the price cache
 * Useful for testing or forcing fresh price fetches
 */
export function clearPriceCache(): void {
    priceCache.clear();
}
