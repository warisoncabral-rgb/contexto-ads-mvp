import { createHash, randomBytes } from 'node:crypto'

const operatorToken = randomBytes(32).toString('base64url')
const operatorDigest = createHash('sha256').update(operatorToken).digest('hex')

console.log('CONTEXT_ADS_OPERATOR_TOKEN=' + operatorToken)
console.log('OPERATOR_BOOTSTRAP_TOKEN_SHA256=' + operatorDigest)
console.log('Use each value once in the corresponding protected Render environment field.')
