import * as cdk from 'aws-cdk-lib';
import { LambdaRestApi } from 'aws-cdk-lib/aws-apigateway';
import { InterfaceVpcEndpointAwsService, SecurityGroup, Vpc } from 'aws-cdk-lib/aws-ec2';
import { AnyPrincipal, Effect, ManagedPolicy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnDomain, CfnUserProfile } from 'aws-cdk-lib/aws-sagemaker';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { CfnIdentityProvider, CfnIpAccessSettings, CfnNetworkSettings, CfnPortal, CfnUserSettings } from 'aws-cdk-lib/aws-workspacesweb';
import { Construct } from 'constructs';
import path = require('path');

export class AwsWorkspacesWebSagemakerStudioStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'workspace-vpc', { maxAzs: 2 });

    const vpces = [
      InterfaceVpcEndpointAwsService.LAMBDA,
      InterfaceVpcEndpointAwsService.KMS,
      InterfaceVpcEndpointAwsService.SSM,
      InterfaceVpcEndpointAwsService.ELASTIC_FILESYSTEM,
      InterfaceVpcEndpointAwsService.SAGEMAKER_STUDIO,
      InterfaceVpcEndpointAwsService.SAGEMAKER_API,
      InterfaceVpcEndpointAwsService.SAGEMAKER_RUNTIME,
      InterfaceVpcEndpointAwsService.SAGEMAKER_NOTEBOOK
    ].forEach(vpce => {
        vpc.addInterfaceEndpoint(
          vpce.shortName, {
            service: vpce,
            privateDnsEnabled: true
          }
        )
      }     
    );

    const sagemakerRole = new Role(this, 'SageMakerExecutionRole', {
      assumedBy: new ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
      ]
    });

    const domain = new CfnDomain(this, 'domain', {
      authMode: 'IAM',
      defaultUserSettings: {
        executionRole: sagemakerRole.roleArn,
      },
      domainName: 'sagemaker-domain',
      vpcId: vpc.vpcId,
      subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
      appNetworkAccessType: 'VpcOnly'
    });

    const userEmail = 'sageuser@nowhere.com';
    const userProfile = new CfnUserProfile(this, 'user-profile', {
      domainId: domain.attrDomainId,
      userProfileName: userEmail.split('@')[0],
      userSettings: {
        executionRole: sagemakerRole.roleArn,
        //Configure user profile for Sagemaker Studio here        
      },
    });

    const signerLambda = new NodejsFunction(this, 'signer-lambda-loader', {
      vpc,
      handler: 'handler',
      runtime: Runtime.NODEJS_LATEST,
      entry: path.join(__dirname, '/../lambda/presign-sage.ts'),
      environment: {
        DOMAIN_ID: domain.attrDomainId,
        USER_PROFILE_NAME: userProfile.userProfileName
      },
      logRetention: RetentionDays.ONE_DAY,
      tracing: Tracing.ACTIVE
    });

    signerLambda.addToRolePolicy(new PolicyStatement({
      actions: [
        'sagemaker:CreatePresignedDomainUrl'
      ],
      resources: [
        `arn:aws:sagemaker:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:user-profile/${domain.attrDomainId}/${userProfile.userProfileName}`
      ]
    }));

    signerLambda.addToRolePolicy(new PolicyStatement({ 
      effect: Effect.DENY,
      actions: [
        'sagemaker:*'
      ],
      resources: [
        `arn:aws:sagemaker:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:user-profile/${domain.attrDomainId}/${userProfile.userProfileName}`
      ],
      conditions: {
        'NotIpAddress': {
          'aws:VpcSourceIp': vpc.vpcCidrBlock
        }
      }
     }));

      
    signerLambda.node.addDependency(domain);
    signerLambda.node.addDependency(userProfile);

    const api = new LambdaRestApi(this, 'sage-signer', {
      handler: signerLambda,
    });

    const kmsPolicyDocument = new PolicyDocument({
      statements: [new PolicyStatement({
        actions: [
          'kms:*',
        ],
        resources: ['*'],
        principals: [new AnyPrincipal()]
      })]
    });
    const cmk = new Key(this, 'my-cmk', {
      policy: kmsPolicyDocument,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // const browserSettings = new CfnBrowserSettings(this, 'browser-settings');
    // const dataProtectionSettings = new CfnDataProtectionSettings(this, 'data-protection-settings');
    // const ipAccessSettings = new CfnIpAccessSettings(this, 'ip-access-settings', {
    //   ipRules: [{
    //     ipRange: vpc.vpcCidrBlock
    //   }]
    // });

    const securitygroup = new SecurityGroup(this, 'security-group', {
      vpc
    });

    const networkSettings = new CfnNetworkSettings(this, 'network-settings', {
      securityGroupIds: [securitygroup.securityGroupId],
      subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
      vpcId: vpc.vpcId,
    });

    // const userAccessLoggingSettings = new CfnUserAccessLoggingSettings(this, 'user-access-logging-settings', {
    //   kinesisStreamArn: ''
    // });

    const userSettings = new CfnUserSettings(this, 'user-settings', {
      customerManagedKey: cmk.keyArn,
      copyAllowed: 'Disabled',
      downloadAllowed: 'Disabled',
      pasteAllowed: 'Enabled',
      printAllowed: 'Disabled',
      uploadAllowed: 'Enabled',
      disconnectTimeoutInMinutes: 20,
      idleDisconnectTimeoutInMinutes: 15,
    });
    
    // const trustStore = new CfnTrustStore(this, 'trust-store', {
    //   certificateList: []
    // });

    const portal = new CfnPortal(this, 'workspace-portal', {
      customerManagedKey: cmk.keyArn,
      displayName: 'workspace-portal',
      instanceType: 'standard.regular',
      maxConcurrentSessions: 2,
      userSettingsArn: userSettings.attrUserSettingsArn,
      networkSettingsArn: networkSettings.attrNetworkSettingsArn,
      // ipAccessSettingsArn: ipAccessSettings.attrIpAccessSettingsArn,
      // trustStoreArn: trustStore.attrTrustStoreArn,
      // userAccessLoggingSettingsArn: userAccessLoggingSettings.attrUserAccessLoggingSettingsArn,
      // browserSettingsArn: browserSettings.attrBrowserSettingsArn,
      // dataProtectionSettingsArn: dataProtectionSettings.attrDataProtectionSettingsArn,
    });
  
    const identityProvider = new CfnIdentityProvider(this, 'identity-provider', {
      identityProviderDetails: {
        MetadataURL: StringParameter.valueForTypedStringParameterV2(this, 'sagemaker-saml-metadata-endpoint'),
      },
      identityProviderName: 'Auth0',
      identityProviderType: 'SAML',
      portalArn: portal.attrPortalArn
    });
    
    new cdk.CfnOutput(this, 'portal-Endpoint', { value: `https://${portal.attrPortalEndpoint}` });
  }
}
