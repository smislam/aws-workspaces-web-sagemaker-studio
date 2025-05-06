#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsWorkspacesWebSagemakerStudioStack } from '../lib/aws-workspaces-web-sagemaker-studio-stack';

const app = new cdk.App();
new AwsWorkspacesWebSagemakerStudioStack(app, 'AwsWorkspacesWebSagemakerStudioStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});