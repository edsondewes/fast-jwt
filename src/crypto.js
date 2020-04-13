'use strict'

const {
  createHmac,
  createVerify,
  createSign,
  timingSafeEqual,
  sign: directSign,
  verify: directVerify,
  constants: {
    RSA_PKCS1_PSS_PADDING,
    RSA_PSS_SALTLEN_DIGEST,
    RSA_PKCS1_PADDING,
    RSA_PSS_SALTLEN_MAX_SIGN,
    RSA_PSS_SALTLEN_AUTO
  }
} = require('crypto')
const { joseToDer, derToJose } = require('ecdsa-sig-formatter')

const base64UrlMatcher = /[=+/]/g
const encoderMap = { '=': '', '+': '-', '/': '_' }

const TokenError = require('./error')

/*
  Note that when using all these verifiers, all the keys have already been converted
  to buffers (including {key, passphrase} case).
  The error messages mention strings just for developer sake.
*/
function validateSecretOrPublicKey(algorithm, key, message) {
  if (key instanceof Buffer || typeof key === 'string') {
    return
  }

  throw new TokenError(TokenError.codes.invalidKey, message)
}

function validatePrivateKey(algorithm, key) {
  const keyType = typeof key

  if (key instanceof Buffer || keyType === 'string') {
    return { key }
  }

  if (keyType !== 'object') {
    throw new TokenError(
      TokenError.codes.invalidKey,
      `The key for algorithm ${algorithm} must be a string, a object or a buffer containing the private key.`
    )
  }

  if (typeof key.key !== 'string' && !(key.key instanceof Buffer)) {
    throw new TokenError(
      TokenError.codes.invalidKey,
      `The key object for algorithm ${algorithm} must have the key property as string or buffer containing the private key.`
    )
  }

  if (key.passphrase && typeof key.passphrase !== 'string' && !(key.passphrase instanceof Buffer)) {
    throw new TokenError(
      TokenError.codes.invalidKey,
      `The key object for algorithm ${algorithm} must have the passphrase property as string or buffer containing the private key.`
    )
  }

  return key
}

function base64UrlReplacer(c) {
  return encoderMap[c]
}

function createSignature(algorithm, key, input) {
  try {
    const type = algorithm.slice(0, 2)
    const alg = `SHA${algorithm.slice(2)}`

    if (type === 'HS') {
      validateSecretOrPublicKey(algorithm, key, `The secret for algorithm ${algorithm} must be a string or a buffer.`)

      return createHmac(alg, key)
        .update(input)
        .digest('base64')
        .replace(base64UrlMatcher, base64UrlReplacer)
    } else if (type === 'Ed') {
      // Check if supported on Node 10
      /* istanbul ignore next */
      if (typeof directSign === 'function') {
        validatePrivateKey(algorithm, key)

        return directSign(undefined, Buffer.from(input, 'utf8'), key)
          .toString('base64')
          .replace(base64UrlMatcher, base64UrlReplacer)
      } else {
        throw new TokenError(TokenError.codes.signError, 'EdDSA algorithms are not supported by your Node.js version.')
      }
    }

    const options = {
      ...validatePrivateKey(algorithm, key),
      padding: RSA_PKCS1_PADDING,
      saltLength: RSA_PSS_SALTLEN_MAX_SIGN
    }

    if (type === 'PS') {
      options.padding = RSA_PKCS1_PSS_PADDING
      options.saltLength = RSA_PSS_SALTLEN_DIGEST
    }

    let signature = createSign('RSA-' + alg)
      .update(input)
      .sign(options, 'base64')

    if (type === 'ES') {
      signature = derToJose(signature, algorithm).toString('base64')
    }

    return signature.replace(base64UrlMatcher, base64UrlReplacer)
  } catch (e) {
    throw new TokenError(TokenError.codes.signError, 'Cannot create the signature.', { originalError: e })
  }
}

function verifySignature(algorithm, key, input, signature) {
  try {
    const type = algorithm.slice(0, 2)
    const alg = `SHA${algorithm.slice(2)}`

    signature = Buffer.from(signature, 'base64')

    if (type === 'HS') {
      validateSecretOrPublicKey(algorithm, key, `The secret for algorithm ${algorithm} must be a string or a buffer.`)

      try {
        return timingSafeEqual(
          createHmac(alg, key)
            .update(input)
            .digest(),
          signature
        )
      } catch (e) {
        return false
      }
    } else if (type === 'Ed') {
      // Check if supported on Node 10
      /* istanbul ignore next */
      if (typeof directVerify === 'function') {
        return directVerify(undefined, Buffer.from(input, 'utf8'), key, signature)
      } else {
        throw new TokenError(TokenError.codes.signError, 'EdDSA algorithms are not supported by your Node.js version.')
      }
    }

    const options = { key, padding: RSA_PKCS1_PADDING, saltLength: RSA_PSS_SALTLEN_AUTO }

    validateSecretOrPublicKey(
      algorithm,
      key,
      `The key for algorithm ${algorithm} must be a string, a object or a buffer containing the public key.`
    )

    if (type === 'PS') {
      options.padding = RSA_PKCS1_PSS_PADDING
      options.saltLength = RSA_PSS_SALTLEN_DIGEST
    } else if (type === 'ES') {
      signature = joseToDer(signature, algorithm)
    }

    return createVerify('RSA-' + alg)
      .update(input)
      .verify(options, signature)
  } catch (e) {
    throw new TokenError(TokenError.codes.verifyError, 'Cannot verify the signature.', { originalError: e })
  }
}

module.exports = {
  base64UrlMatcher,
  base64UrlReplacer,
  createSignature,
  verifySignature
}
