import { JBCENTER_DEFAULT_URL } from "@bananapus/nana-sdk-core/jbcenter";

const DEV_SITE_URL = "https://dev.revnet.money";
const DEV_CENTER_URL = "https://dev.juicebox.center";
const PRODUCTION_SITE_URL = "https://revnet.money";

export function jbCenterBaseUrl(siteUrl = process.env.NEXT_PUBLIC_SITE_URL): string {
  return siteUrl === DEV_SITE_URL ? DEV_CENTER_URL : JBCENTER_DEFAULT_URL;
}

export function jbCenterAppOrigin(siteUrl = process.env.NEXT_PUBLIC_SITE_URL): string {
  return siteUrl === DEV_SITE_URL ? DEV_SITE_URL : PRODUCTION_SITE_URL;
}
