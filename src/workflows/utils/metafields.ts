type ShopifyMetafields = Record<string, string>;

/**
 * Extrae un valor numérico (float) de un metafield
 */
export const getFloatFromMetafield = (
  metafields: ShopifyMetafields,
  key: string
): number | undefined => {
  const value = metafields[key];
  if (value) {
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
  if (value) {
    return (
      value.toLowerCase() === "true" ||
      value.toLowerCase() === "yes" ||
      value.toLowerCase() === "1"
    );
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
