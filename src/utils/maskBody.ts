type AnyObject = Record<string, any>;

export const maskBody = (
  input: any,
): any => {

  // ---------- helper ----------
  const keepStartEnd = (str: string, keepStart: number, keepEnd: number) => {
    const start = str.slice(0, keepStart);
    const end = str.slice(-keepEnd);
    const middle = 'X'.repeat(Math.max(str.length - keepStart - keepEnd, 0));
    return start + middle + end;
  };

  // ---------- detector ----------
  const detectType = (key: string, value: string): string => {
    const k = key.toLowerCase();

    if (k.includes('phone') || k.includes('msisdn') || /^0\d{9}$/.test(value)) {
      return 'phone';
    }

    if(k.includes('fbb_id')){
      return 'fbbId'
    }

    if (k.includes('email')) {
      return 'email';
    }

    if (k.includes('card')) {
      return 'card';
    }

    if (k.includes('bank_account')) {
      return 'bankAccount';
    }

    if (k.includes('citizen_id')) {
      return 'citizenId';
    }

    if (k.includes('name')) {
      return 'name';
    }

    if (k.includes('first_name')) {
      return 'firstName';
    }

    if (k.includes('last_name')) {
      return 'lastName';
    }

    if (k.includes('url') || k.includes('link')) {
      return 'url';
    }

    return 'none';
  };

  // ---------- masking ----------
  const maskValue = (type: string, value: string): string => {

    switch (type) {
      case 'phone':
        return keepStartEnd(value, 3, 4);

      case 'fbbId':
        return keepStartEnd(value, 2, 4);

      case 'citizenId':
        return keepStartEnd(value, 0, 4);

      case 'card':
        return keepStartEnd(value, 6, 4);

      case 'bankAccount':
        return keepStartEnd(value, 4, 3);

      case 'email':
        return keepStartEnd(value,3,0)

      case 'name': {
        const [first, last] = value.trim().split(' ');
        if (!last) return value;
        return `${first} XXXXX`;
      }

      case 'firstName':
        return keepStartEnd(value,3,0)

      case 'lastName':
        return keepStartEnd(value,3,0)

      case 'url':
        try {
          const u = new URL(value);
          return `${u.protocol}//${u.hostname}`;
        } catch {
          return value;
        }

      default:
        return value;
    }
  };

  // ---------- recursive ----------
  const process = (data: any): any => {
    if (Array.isArray(data)) {
      return data.map(process);
    }

    if (data !== null && typeof data === 'object') {
      const result: AnyObject = {};
      for (const key in data) {
        result[key] = process(data[key]);
      }
      return result;
    }

    if (typeof data === 'string') {
      // ไม่มี key → treat as generic
      return maskValue('none', data);
    }

    return data;
  };

  // ---------- main processing ----------
  const processWithKey = (data: any, parentKey = ''): any => {
    if (Array.isArray(data)) {
      return data.map((item) => processWithKey(item, parentKey));
    }

    if (data !== null && typeof data === 'object') {
      const result: AnyObject = {};
      for (const key in data) {
        result[key] = processWithKey(data[key], key);
      }
      return result;
    }

    if (typeof data === 'string') {
      const type = detectType(parentKey, data);
      return maskValue(type, data);
    }

    return data;
  };

  return processWithKey(input);
};