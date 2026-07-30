import { FacilityStandardsClient } from "./client";

// 静的JSONはサイトと同じ場所に配信される。base="./"のため相対パスで解決する。
export const facilityClient = new FacilityStandardsClient({
  baseUrl: import.meta.env.BASE_URL,
});
