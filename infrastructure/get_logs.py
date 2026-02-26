import boto3
import sys

def main():
    logs = boto3.client('logs', region_name='us-east-1')
    try:
        streams = logs.describe_log_streams(logGroupName='/aws/lambda/ocr_invoke_modal', orderBy='LastEventTime', descending=True, limit=3)
        for stream in streams['logStreams']:
            print(f"--- Stream: {stream['logStreamName']} ---")
            events = logs.get_log_events(logGroupName='/aws/lambda/ocr_invoke_modal', logStreamName=stream['logStreamName'])
            for e in events['events']:
                print(e['message'].strip())
    except Exception as e:
        print(f"Error fetching logs: {e}")

if __name__ == "__main__":
    main()
