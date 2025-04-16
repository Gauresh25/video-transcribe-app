// AWS config constants - hardcoded for simplicity
export const AWS_CONFIG = {
    accessKeyId: 'AKIAYUQGTCXVT2VNZYGH',
    secretAccessKey: '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',
    region: 'ap-south-1',
    bucket: 'connecttsec'
  };
  
  // Helper function to generate unique file names
  export const generateUniqueFileName = (originalName: string): string => {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const extension = originalName.split('.').pop();
    return `${timestamp}-${randomString}.${extension}`;
  };
  
  export const getBucketName = (): string => AWS_CONFIG.bucket;