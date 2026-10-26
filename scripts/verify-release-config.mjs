import { loadEnv } from 'vite'
import { validateReleaseConfig } from './release-config.mjs'
validateReleaseConfig(loadEnv('production',process.cwd(),'VITE_'))
console.log('Public release configuration verified. Server-side keys and live integration still require release review.')
