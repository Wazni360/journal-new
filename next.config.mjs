const nextConfig = {
  // Knex ships every dialect and resolves them dynamically; bundling it breaks. Leave it to Node.
  serverExternalPackages: ["knex", "pg"],
};

export default nextConfig;
