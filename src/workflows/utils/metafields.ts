type ShopifyMetafields = Record<string, string>;

/**
 * Extrae un valor numérico (float) de un metafield
 */
export const getFloatFromMetafield = (
  metafields: ShopifyMetafields,
  key: string
): number | undefined => {
  const value = metafields[key];
  if (value !== undefined && value !== null) {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

/**
 * Extrae un valor booleano de un metafield
 */
export const getBooleanFromMetafield = (
  metafields: ShopifyMetafields,
  key: string
): boolean | undefined => {
  const value = metafields[key];
  if (value !== undefined && value !== null) {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }
  return undefined;
};

/**
 * Extrae un valor string de un metafield
 */
export const getStringFromMetafield = (
  metafields: ShopifyMetafields,
  key: string
): string | undefined => {
  const value = metafields[key];
  if (value) {
    return value.trim();
  }
  return undefined;
};
