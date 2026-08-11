#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs/promises';
import CP from 'node:child_process';
import StaticCapabilities, { CAPABILITIES_ANNOTATION } from '../src/capabilities.js';

/**
 * Build the ETL task container in the current directory and push it to AWS ECR
 *
 * Usage (from the root of an ETL repo containing a Dockerfile and a capabilities.json):
 *    npx cloudtak-etl
 */

if (process.argv.slice(2).includes('--help') || process.argv.slice(2).includes('-h')) {
    console.log('Usage: cloudtak-etl');
    console.log('');
    console.log('Build the ETL task container in the current directory and push it to AWS ECR');
    console.log('');
    console.log('The current directory must contain a Dockerfile and a capabilities.json');
    console.log('');
    console.log('Required Environment Variables:');
    console.log('  AWS_REGION      The AWS region the CloudTAK deployment lives in');
    console.log('  AWS_ACCOUNT_ID  The 12 digit AWS account ID hosting the ECR repository');
    console.log('  Environment     (Optional) Deployment environment - defaults to prod');
    process.exit(0);
}

process.env.Environment = process.env.Environment || 'prod';

for (const env of [
    'AWS_REGION',
    'AWS_ACCOUNT_ID',
    'Environment'
]) {
    if (!process.env[env]) {
        throw new Error(`${env} Env Var must be set`);
    }
}

await login();
await build();

function login(): Promise<void> {
    return new Promise((resolve, reject) => {
        const $ = CP.exec(`
            aws ecr get-login-password \
                --region $\{AWS_REGION} \
            | docker login \
                --username AWS \
                --password-stdin "$\{AWS_ACCOUNT_ID}.dkr.ecr.$\{AWS_REGION}.amazonaws.com"

        `, (err) => {
            if (err) return reject(err);
            return resolve();
        });

        $.stdout?.pipe(process.stdout);
        $.stderr?.pipe(process.stderr);
    });
}

async function capabilities(capspath: string): Promise<string | null> {
    let doc;
    try {
        doc = await StaticCapabilities.read(capspath);
    } catch (err) {
        console.error(`not ok - ${capspath}: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }

    return doc ? JSON.stringify(doc) : null;
}

async function build(): Promise<void> {
    // Get Git Repo Name
    const basename = path.basename(CP.execSync(`
        git rev-parse --show-toplevel
    `).toString().trim());

    const pkg = JSON.parse(String(await fs.readFile('./package.json'))) as { version: string };

    const caps = await capabilities('./capabilities.json');

    if (!caps) {
        console.error('not ok - ETL builds require a capabilities.json alongside the source code');
        process.exit(1);
    }

    console.error('ok - found capabilities.json - annotating manifest');

    return new Promise((resolve, reject) => {
        const $ = CP.exec(`
            docker buildx build . \
                --platform linux/amd64 \
                --provenance=false \
                --annotation "${CAPABILITIES_ANNOTATION}=$\{CLOUDTAK_CAPABILITIES}" \
                --output type=image,oci-mediatypes=true,push=true \
                -t "$\{AWS_ACCOUNT_ID}.dkr.ecr.$\{AWS_REGION}.amazonaws.com/tak-vpc-${process.env.Environment}-cloudtak-tasks:${basename}-v${pkg.version}"
        `, {
            env: { ...process.env, CLOUDTAK_CAPABILITIES: caps }
        }, (err) => {
            if (err) return reject(err);
            return resolve();
        });

        $.stdout?.pipe(process.stdout);
        $.stderr?.pipe(process.stderr);
    });
}
