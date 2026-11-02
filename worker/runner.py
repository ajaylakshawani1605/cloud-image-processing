"""One request per process over stdin/stdout. Credentials are inherited from environment."""
import json
import os
import sys
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from processing import transform, PermanentError

def main():
    payload = json.loads(sys.stdin.read(32768))
    s3 = boto3.client('s3', endpoint_url=os.environ['S3_ENDPOINT'], region_name=os.getenv('S3_REGION', 'us-east-1'),
        aws_access_key_id=os.environ['S3_ACCESS_KEY'], aws_secret_access_key=os.environ['S3_SECRET_KEY'],
        config=Config(connect_timeout=5, read_timeout=20, retries={'max_attempts': 2}, s3={'addressing_style': 'path'}))
    try:
        response = s3.get_object(Bucket=os.getenv('S3_ORIGINAL_BUCKET', 'originals'), Key=payload['originalKey'])
        limit = int(os.getenv('MAX_UPLOAD_MB', '10')) * 1024 * 1024
        with response['Body'] as stream:
            data = stream.read(limit + 1)
        if len(data) > limit:
            raise PermanentError('Stored image exceeds the upload size limit')
        result, metadata = transform(data, payload['transformations'], int(os.getenv('MAX_IMAGE_PIXELS', '25000000')))
        s3.put_object(Bucket=os.getenv('S3_OUTPUT_BUCKET', 'processed'), Key=payload['outputKey'], Body=result, ContentType=metadata['mime'])
        print(json.dumps({'ok': True, 'metadata': metadata}), flush=True)
    except PermanentError as exc:
        print(json.dumps({'ok': False, 'permanent': True, 'error': str(exc)}), flush=True)
    except ClientError as exc:
        permanent = exc.response['Error']['Code'] in ('NoSuchKey', 'NoSuchBucket', 'AccessDenied')
        print(json.dumps({'ok': False, 'permanent': permanent, 'error': 'Original is missing or storage access is denied' if permanent else 'Storage temporarily unavailable'}), flush=True)
    except Exception:
        print(json.dumps({'ok': False, 'permanent': False, 'error': 'Processing service temporarily unavailable'}), flush=True)

if __name__ == '__main__':
    main()
