import { Module } from "@medusajs/framework/utils";
import ShopifyService from "./service";

export const SHOPIFY_MODULE = "shopify"

export default Module(SHOPIFY_MODULE, {
  service: ShopifyService
})