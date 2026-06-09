#!/usr/bin/env bash

# Environment Variables Validation Script
# Run this to check if required environment variables are set

echo "🔍 Checking environment variables for The Eye monorepo..."
echo ""

# Required variables
REQUIRED_VARS=(
    "DATABASE_URL"
    "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"
    "AZURE_DOCUMENT_INTELLIGENCE_KEY"
    "REDIS_URL"
)

# Optional variables with defaults
OPTIONAL_VARS=(
    "CONFIDENCE_THRESHOLD_DEFAULT"
    "CONFIDENCE_THRESHOLD_JUDGMENT"
    "CONFIDENCE_THRESHOLD_CONTRACT"
    "CONFIDENCE_THRESHOLD_POLICE_REPORT"
    "CONFIDENCE_THRESHOLD_WITNESS_STATEMENT"
    "CONFIDENCE_THRESHOLD_PLEADING"
)

missing_required=0
missing_optional=0

echo "📋 Required Variables:"
echo "---------------------"
for var in "${REQUIRED_VARS[@]}"; do
    if [ -n "${!var}" ]; then
        echo "✅ $var: Set"
    else
        echo "❌ $var: Missing"
        ((missing_required++))
    fi
done

echo ""
echo "📋 Optional Variables (with defaults):"
echo "-------------------------------------"
for var in "${OPTIONAL_VARS[@]}"; do
    if [ -n "${!var}" ]; then
        echo "✅ $var: Set (${!var})"
    else
        echo "⚠️  $var: Using default"
        ((missing_optional++))
    fi
done

echo ""
echo "📊 Summary:"
echo "-----------"
echo "Required variables set: $((4 - missing_required))/4"
echo "Optional variables set: $((6 - missing_optional))/6"

if [ $missing_required -gt 0 ]; then
    echo ""
    echo "❌ Some required environment variables are missing!"
    echo "   Please check ENVIRONMENT_VARIABLES.md for setup instructions."
    exit 1
else
    echo ""
    echo "✅ All required environment variables are configured!"
    echo "   You can now run the applications."
    exit 0
fi
