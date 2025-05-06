import { CreatePresignedDomainUrlCommand, CreatePresignedDomainUrlRequest, SageMakerClient } from "@aws-sdk/client-sagemaker";
import { Context, Handler } from "aws-lambda";

const sagemakerClient = new SageMakerClient({region: process.env.REGION});

export const handler: Handler = async (event: any, context: Context) => {
    const domainUrlReq: CreatePresignedDomainUrlRequest = {
        DomainId: process.env.DOMAIN_ID,
        UserProfileName: process.env.USER_PROFILE_NAME,
        SessionExpirationDurationInSeconds: 3600,
    }
    try {
        const response = await sagemakerClient.send(new CreatePresignedDomainUrlCommand(domainUrlReq));
        // const notebookUrl = await sagemakerClient.send(new CreatePresignedNotebookInstanceUrlCommand('HAHAHA'));

        return {
            statusCode: 302,
            headers: {
                Location: response.AuthorizedUrl
            }
        }
    } catch (error) {
        let message = error;
        if (error instanceof Error) {
            message = error.message;
        }

        return {
            statusCode: 500,
            body: JSON.stringify(`Error with URL: ${message}`)
        }
    }
}