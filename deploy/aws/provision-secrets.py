"""Run with the AWS account administrator in CloudShell. Contains no secret values."""
import json
import subprocess

ACCOUNT = '473488814075'
REGION = 'sa-east-1'
SECRET_NAME = 'nutriplus/production/application'
ROLE_NAME = 'nutriplus-application-secrets'
SOURCE_USER = 'nutriplus-backup'

def aws(*args, absent=None):
    result = subprocess.run(['aws', *args, '--output', 'json'], capture_output=True, text=True)
    if result.returncode:
        if absent and absent in result.stderr:
            return None
        raise RuntimeError('AWS operation failed: ' + ' '.join(args[:2]))
    return json.loads(result.stdout) if result.stdout.strip() else {}

if aws('sts', 'get-caller-identity')['Account'] != ACCOUNT:
    raise RuntimeError('Wrong AWS account')

secret = aws('secretsmanager', 'describe-secret', '--secret-id', SECRET_NAME, '--region', REGION, absent='ResourceNotFoundException')
if secret is None:
    secret = aws('secretsmanager', 'create-secret', '--name', SECRET_NAME, '--description', 'Nutri+ production database and SES SMTP credentials', '--region', REGION)
secret_arn = secret['ARN']
role_arn = f'arn:aws:iam::{ACCOUNT}:role/{ROLE_NAME}'
trust = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Principal': {'AWS': f'arn:aws:iam::{ACCOUNT}:user/{SOURCE_USER}'}, 'Action': 'sts:AssumeRole'}]}
role = aws('iam', 'get-role', '--role-name', ROLE_NAME, absent='NoSuchEntity')
if role is None:
    aws('iam', 'create-role', '--role-name', ROLE_NAME, '--assume-role-policy-document', json.dumps(trust), '--description', 'Nutri+ application: read only its production secret', '--max-session-duration', '3600')
elif role['Role']['AssumeRolePolicyDocument'] != trust:
    raise RuntimeError('Existing role has different trust; review before changing')
read = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Action': 'secretsmanager:GetSecretValue', 'Resource': secret_arn}]}
assume = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Action': 'sts:AssumeRole', 'Resource': role_arn}]}
provision = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Action': 'secretsmanager:PutSecretValue', 'Resource': secret_arn}]}
aws('iam', 'put-role-policy', '--role-name', ROLE_NAME, '--policy-name', 'ReadNutriPlusApplicationSecret', '--policy-document', json.dumps(read))
aws('iam', 'put-user-policy', '--user-name', SOURCE_USER, '--policy-name', 'AssumeNutriPlusApplicationRole', '--policy-document', json.dumps(assume))
aws('iam', 'put-user-policy', '--user-name', SOURCE_USER, '--policy-name', 'TemporaryNutriPlusSecretProvisioning', '--policy-document', json.dumps(provision))
print(json.dumps({'ready': True, 'secretArn': secret_arn, 'roleArn': role_arn, 'temporaryPolicyToRemove': 'TemporaryNutriPlusSecretProvisioning'}))
