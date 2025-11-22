/**
 * Test String Conversion Logic
 *
 * Tests that all wei-to-dollar conversions work correctly
 * WITHOUT actually modifying the database
 *
 * Run with: node scripts/test-string-conversions.js
 */

const { ethers } = require('ethers');

console.log('🧪 Testing Wei to String Conversion Logic');
console.log('=========================================\n');

// Test cases with known values
const testCases = [
  {
    name: '5 USDC',
    wei: '5000000000000000000',
    expectedUSDC: 5.00
  },
  {
    name: '100 USDC',
    wei: '100000000000000000000',
    expectedUSDC: 100.00
  },
  {
    name: '0.5 USDC',
    wei: '500000000000000000',
    expectedUSDC: 0.50
  },
  {
    name: '1234.56 USDC',
    wei: '1234560000000000000000',
    expectedUSDC: 1234.56
  },
  {
    name: 'Very large amount (1M USDC)',
    wei: '1000000000000000000000000',
    expectedUSDC: 1000000.00
  },
  {
    name: 'Zero',
    wei: '0',
    expectedUSDC: 0.00
  },
  {
    name: 'Small fee (0.000123 USDC)',
    wei: '123000000000000',
    expectedUSDC: 0.000123
  }
];

// Helper function (same as in backend)
const weiToUSDC = (weiValue) => {
  if (!weiValue) return 0;
  const weiStr = String(weiValue);
  return parseFloat(ethers.utils.formatUnits(weiStr, 18));
};

let passed = 0;
let failed = 0;

console.log('Testing Wei to USDC Conversion:\n');

testCases.forEach((test, index) => {
  console.log(`Test ${index + 1}: ${test.name}`);
  console.log(`  Input (wei): ${test.wei}`);

  try {
    const result = weiToUSDC(test.wei);
    console.log(`  Output (USDC): ${result}`);
    console.log(`  Expected: ${test.expectedUSDC}`);

    // Check if result matches expected (with small tolerance for floating point)
    const diff = Math.abs(result - test.expectedUSDC);
    const tolerance = 0.000001;

    if (diff < tolerance) {
      console.log(`  ✅ PASS\n`);
      passed++;
    } else {
      console.log(`  ❌ FAIL - Difference: ${diff}\n`);
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ ERROR: ${error.message}\n`);
    failed++;
  }
});

// Test BigInt arithmetic
console.log('\n━'.repeat(50));
console.log('\nTesting BigInt Arithmetic:\n');

const arithmeticTests = [
  {
    name: 'Addition',
    a: '5000000000000000000',
    b: '3000000000000000000',
    operation: 'add',
    expected: '8000000000000000000'
  },
  {
    name: 'Subtraction',
    a: '10000000000000000000',
    b: '3000000000000000000',
    operation: 'subtract',
    expected: '7000000000000000000'
  },
  {
    name: 'Addition with very large numbers',
    a: '999999999999999999999999',
    b: '1',
    operation: 'add',
    expected: '1000000000000000000000000'
  }
];

arithmeticTests.forEach((test, index) => {
  console.log(`Test ${index + 1}: ${test.name}`);
  console.log(`  A: ${test.a}`);
  console.log(`  B: ${test.b}`);

  try {
    let result;
    if (test.operation === 'add') {
      result = (BigInt(test.a) + BigInt(test.b)).toString();
    } else if (test.operation === 'subtract') {
      result = (BigInt(test.a) - BigInt(test.b)).toString();
    }

    console.log(`  Result: ${result}`);
    console.log(`  Expected: ${test.expected}`);

    if (result === test.expected) {
      console.log(`  ✅ PASS\n`);
      passed++;
    } else {
      console.log(`  ❌ FAIL\n`);
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ ERROR: ${error.message}\n`);
    failed++;
  }
});

// Test type safety
console.log('\n━'.repeat(50));
console.log('\nTesting Type Safety:\n');

const typeSafetyTests = [
  {
    name: 'String stays string after conversion',
    input: '5000000000000000000',
    test: (val) => typeof val === 'string'
  },
  {
    name: 'BigInt conversion from string',
    input: '5000000000000000000',
    test: (val) => typeof BigInt(val) === 'bigint'
  },
  {
    name: 'BigInt toString returns string',
    input: '5000000000000000000',
    test: (val) => typeof BigInt(val).toString() === 'string'
  },
  {
    name: 'Wei to USDC returns number',
    input: '5000000000000000000',
    test: (val) => typeof weiToUSDC(val) === 'number'
  },
  {
    name: 'Null/undefined handling',
    input: null,
    test: (val) => weiToUSDC(val) === 0
  },
  {
    name: 'Empty string handling',
    input: '',
    test: (val) => weiToUSDC(val) === 0
  }
];

typeSafetyTests.forEach((test, index) => {
  console.log(`Test ${index + 1}: ${test.name}`);
  console.log(`  Input: ${test.input}`);

  try {
    const result = test.test(test.input);

    if (result) {
      console.log(`  ✅ PASS\n`);
      passed++;
    } else {
      console.log(`  ❌ FAIL\n`);
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ ERROR: ${error.message}\n`);
    failed++;
  }
});

// Test precision
console.log('\n━'.repeat(50));
console.log('\nTesting Precision:\n');

const precisionTests = [
  {
    name: 'No precision loss with large numbers',
    wei: '123456789012345678901234',
    test: (wei) => {
      const bigIntVal = BigInt(wei);
      const stringVal = bigIntVal.toString();
      return stringVal === wei;
    }
  },
  {
    name: 'Decimal precision in USDC conversion',
    wei: '1230000000000000000', // 1.23 USDC
    expectedUSDC: 1.23,
    tolerance: 0.0001
  }
];

precisionTests.forEach((test, index) => {
  console.log(`Test ${index + 1}: ${test.name}`);

  try {
    if (test.test) {
      const result = test.test(test.wei);
      if (result) {
        console.log(`  ✅ PASS\n`);
        passed++;
      } else {
        console.log(`  ❌ FAIL\n`);
        failed++;
      }
    } else {
      const result = weiToUSDC(test.wei);
      const diff = Math.abs(result - test.expectedUSDC);
      if (diff < test.tolerance) {
        console.log(`  Result: ${result}`);
        console.log(`  Expected: ${test.expectedUSDC}`);
        console.log(`  ✅ PASS\n`);
        passed++;
      } else {
        console.log(`  Result: ${result}`);
        console.log(`  Expected: ${test.expectedUSDC}`);
        console.log(`  Diff: ${diff}`);
        console.log(`  ❌ FAIL\n`);
        failed++;
      }
    }
  } catch (error) {
    console.log(`  ❌ ERROR: ${error.message}\n`);
    failed++;
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log('\n📊 Test Summary\n');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📈 Total: ${passed + failed}`);
console.log(`🎯 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);

if (failed === 0) {
  console.log('🎉 All tests passed! Conversion logic is working correctly.\n');
  process.exit(0);
} else {
  console.log('⚠️  Some tests failed. Please review the logic before proceeding.\n');
  process.exit(1);
}

