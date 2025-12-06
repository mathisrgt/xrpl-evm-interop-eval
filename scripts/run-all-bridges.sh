#!/bin/bash

# Script to run all bridge directions sequentially
# Usage: ./scripts/run-all-bridges.sh [AMOUNT] [RUNS]

set -e  # Exit on error

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Default values
AMOUNT=${1:-5}  # Default: 5 XRP for non-Flare bridges
RUNS=${2:-1}    # Default: 1 run per direction

# Function to display help
show_help() {
    echo -e "${BOLD}${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║              Run All Bridge Directions - Batch Test Script                  ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo -e "${BOLD}USAGE:${NC}"
    echo "  ./scripts/run-all-bridges.sh [AMOUNT] [RUNS]"
    echo ""
    echo -e "${BOLD}PARAMETERS:${NC}"
    echo -e "  ${CYAN}AMOUNT${NC}    Amount of XRP to bridge for non-Flare bridges (default: 5)"
    echo -e "  ${CYAN}RUNS${NC}      Number of test runs per direction (default: 1)"
    echo ""
    echo -e "${BOLD}BRIDGE DIRECTIONS TESTED:${NC}"
    echo -e "  ${YELLOW}1.${NC} XRPL → Flare       (FAsset - fixed: 10 XRP, 1 run)"
    echo -e "  ${YELLOW}2.${NC} Flare → XRPL       (FAsset - fixed: 10 FXRP, 1 run)"
    echo -e "  ${YELLOW}3.${NC} XRPL → XRPL-EVM    (Axelar - uses AMOUNT and RUNS)"
    echo -e "  ${YELLOW}4.${NC} XRPL-EVM → XRPL    (Axelar - uses AMOUNT and RUNS)"
    echo -e "  ${YELLOW}5.${NC} XRPL → Base        (Near Intents - uses AMOUNT and RUNS)"
    echo -e "  ${YELLOW}6.${NC} Base → XRPL        (Near Intents - uses AMOUNT and RUNS)"
    echo ""
    echo -e "${BOLD}EXAMPLES:${NC}"
    echo -e "  ${CYAN}# Run all bridges with 3 XRP and 2 runs each${NC}"
    echo "  ./scripts/run-all-bridges.sh 3 2"
    echo ""
    echo -e "  ${CYAN}# Run all bridges with default values (5 XRP, 1 run)${NC}"
    echo "  ./scripts/run-all-bridges.sh"
    echo ""
    echo -e "  ${CYAN}# Show this help message${NC}"
    echo "  ./scripts/run-all-bridges.sh --help"
    echo ""
    echo -e "${BOLD}NOTES:${NC}"
    echo -e "  ${YELLOW}•${NC} All operations use mainnet (real funds)"
    echo -e "  ${YELLOW}•${NC} FAsset bridges always use 10 XRP/FXRP and 1 run (fixed)"
    echo -e "  ${YELLOW}•${NC} Make sure you have sufficient balance on all chains"
    echo -e "  ${YELLOW}•${NC} Results are saved to data/results/ for each direction"
    echo ""
}

# Check for help flag
if [[ "$1" == "--help" || "$1" == "-h" ]]; then
    show_help
    exit 0
fi

# Validate AMOUNT is a positive number
if ! [[ "$AMOUNT" =~ ^[0-9]+\.?[0-9]*$ ]] || (( $(echo "$AMOUNT <= 0" | bc -l) )); then
    echo -e "${RED}❌ Error: AMOUNT must be a positive number${NC}"
    echo ""
    show_help
    exit 1
fi

# Validate RUNS is a positive integer
if ! [[ "$RUNS" =~ ^[0-9]+$ ]] || [[ "$RUNS" -le 0 ]]; then
    echo -e "${RED}❌ Error: RUNS must be a positive integer${NC}"
    echo ""
    show_help
    exit 1
fi

# Display configuration
echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════════════════════════════════════════════╗"
echo "║                   Running All Bridge Directions                              ║"
echo "╚══════════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "${BOLD}Configuration:${NC}"
echo -e "  Amount (non-Flare): ${GREEN}${AMOUNT} XRP${NC}"
echo -e "  Runs per direction: ${GREEN}${RUNS}${NC}"
echo -e "  Total tests:        ${GREEN}6 directions${NC}"
echo ""
echo -e "${YELLOW}⚠️  Warning: This will use real funds on mainnet!${NC}"
echo ""
read -p "Press Enter to continue or Ctrl+C to cancel..."
echo ""

# Counter for completed tests
COMPLETED=0
TOTAL=6
FAILED=0

# Array to store failed tests
declare -a FAILED_TESTS

# Function to run a bridge test
run_bridge_test() {
    local direction_num=$1
    local src=$2
    local dst=$3
    local amount=$4
    local runs=$5
    local bridge_name=$6

    echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}[${direction_num}/${TOTAL}] Testing: ${YELLOW}${src} → ${dst}${NC} ${BOLD}(${bridge_name})${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"

    if npm start -- --src "$src" --dst "$dst" --amount "$amount" --runs "$runs"; then
        COMPLETED=$((COMPLETED + 1))
        echo -e "${GREEN}✅ Completed: ${src} → ${dst}${NC}"
        echo ""
    else
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("${src} → ${dst}")
        echo -e "${RED}❌ Failed: ${src} → ${dst}${NC}"
        echo ""

        # Ask user if they want to continue
        echo -e "${YELLOW}Test failed. Do you want to continue with remaining tests?${NC}"
        read -p "Press Enter to continue or Ctrl+C to cancel..."
        echo ""
    fi
}

# Navigate to project root (in case script is run from scripts/ directory)
cd "$(dirname "$0")/.."

# Start timestamp
START_TIME=$(date +%s)

echo -e "${BOLD}Starting batch bridge tests...${NC}"
echo ""

# Run all bridge tests
# 1. XRPL → Flare (FAsset - fixed amount and runs)
run_bridge_test 1 "xrpl" "flare" 10 1 "FAsset"

# 2. Flare → XRPL (FAsset - fixed amount and runs)
run_bridge_test 2 "flare" "xrpl" 10 1 "FAsset"

# 3. XRPL → XRPL-EVM (Axelar)
run_bridge_test 3 "xrpl" "xrpl-evm" "$AMOUNT" "$RUNS" "Axelar"

# 4. XRPL-EVM → XRPL (Axelar)
run_bridge_test 4 "xrpl-evm" "xrpl" "$AMOUNT" "$RUNS" "Axelar"

# 5. XRPL → Base (Near Intents)
run_bridge_test 5 "xrpl" "base" "$AMOUNT" "$RUNS" "Near Intents"

# 6. Base → XRPL (Near Intents)
run_bridge_test 6 "base" "xrpl" "$AMOUNT" "$RUNS" "Near Intents"

# End timestamp
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

# Display final summary
echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════════════════════════════════════════════╗"
echo "║                           Batch Test Complete                                ║"
echo "╚══════════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "${BOLD}Summary:${NC}"
echo -e "  Total tests:     ${CYAN}${TOTAL}${NC}"
echo -e "  Completed:       ${GREEN}${COMPLETED}${NC}"
echo -e "  Failed:          ${RED}${FAILED}${NC}"
echo -e "  Duration:        ${CYAN}${MINUTES}m ${SECONDS}s${NC}"
echo ""

# Show failed tests if any
if [[ $FAILED -gt 0 ]]; then
    echo -e "${BOLD}${RED}Failed tests:${NC}"
    for test in "${FAILED_TESTS[@]}"; do
        echo -e "  ${RED}✗${NC} ${test}"
    done
    echo ""
    echo -e "${YELLOW}💡 Check the logs above for error details${NC}"
    echo ""
    exit 1
else
    echo -e "${GREEN}✅ All bridge tests completed successfully!${NC}"
    echo ""
    echo -e "${BOLD}Results location:${NC}"
    echo -e "  ${CYAN}data/results/${NC}"
    echo ""
fi
