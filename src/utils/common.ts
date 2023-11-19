import { bech32 } from "bech32";
import { createHash, randomBytes } from "crypto";
import querystring from "querystring";

export const hexToUint8Array = (hexString: string) => {
  return new Uint8Array(hexString.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
};

export const stringToUint8Array = (str: string) => {
  return Uint8Array.from(str, (x) => x.charCodeAt(0));
};

export const bytesToString = (bytes: ArrayLike<number>) => {
  return String.fromCharCode.apply(null, bytes as any);
};

export function uint8ArrayToUnicodeString(ua: Uint8Array) {
  var binstr = Array.prototype.map
    .call(ua, function (ch) {
      return String.fromCharCode(ch);
    })
    .join("");
  var escstr = binstr.replace(/(.)/g, function (m, p) {
    var code = p.charCodeAt(0).toString(16).toUpperCase();
    if (code.length < 2) {
      code = "0" + code;
    }
    return "%" + code;
  });
  return decodeURIComponent(escstr);
}

export const bytesToHexString = (bytes: Buffer | Uint8Array) => {
  // console.log("inside bytesToHexString");
  // console.log(bytes);
  return bytes.reduce(function (memo, i) {
    return memo + ("0" + i.toString(16)).slice(-2); //padd with leading 0 if <16
  }, "");
};

export const generateBytes = (n: number): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    randomBytes(n, function (error, buffer) {
      if (error) {
        reject(error);
        return;
      }
      resolve(buffer);
    });
  });
};

export const generateShortChannelId = (): Promise<number> => {
  // According to https://github.com/lightningnetwork/lightning-rfc/blob/master/01-messaging.md#fundamental-types
  // `short_channel_id` is 8 byte
  return new Promise((resolve, reject) => {
    randomBytes(8, function (error, buffer) {
      if (error) {
        reject(error);
        return;
      }
      resolve(buffer.readUInt32BE());
    });
  });
};

export const timeout = (time: number) =>
  new Promise((resolve) => setTimeout(() => resolve(void 0), time));

export function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Buffer(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest();
}

export function randomIntegerRange(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export interface LnUrlAuthQuerystring {
  k1: string;
  sig: string;
  key: string;
}

export function createLnUrlAuth(k1: string, url: string) {
  const params = querystring.encode({
    tag: "login",
    k1,
  });
  return bech32.encode("lnurl", bech32.toWords(stringToUint8Array(url + "?" + params)), 1024);
}
