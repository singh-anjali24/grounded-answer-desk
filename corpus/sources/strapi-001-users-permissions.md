# Users & Permissions
- Source ID: strapi-001
- URL: https://docs.strapi.io/cms/features/users-permissions
- Topic: permissions
- Version: Strapi 5

## Summary
Users & Permissions manages end-user accounts, JWT-based authentication, and role-based access to APIs.

## Roles
The Users & Permissions feature allows creating and managing roles for end users, to configure what they can have access to.

## Creating a new role
Path: Users & Permissions plugin > Roles.
On the top right side of the Roles interface, an Add new role button is displayed.
It allows creating a new role for end users of your Strapi application.

## Permissions
Configure the end-user role's permissions by clicking on the name of the permission category and ticking the boxes of the actions and permissions to grant for the role.

## Deleting a role
Although the Public role cannot be deleted, other roles can be deleted.
Users currently assigned to a deleted role are automatically reassigned to the Public role.

## Providers
The Users & Permissions feature allows enabling and configuring providers for end users to log in via a third-party provider.
By default, Email is enabled for all Strapi applications with Users & Permissions enabled.

## Email templates
The Users & Permissions feature uses 2 email templates: Email address confirmation and Reset password.

## Advanced settings
All settings related to Users & Permissions are managed from the Advanced Settings interface, including the default role for end users, sign-ups, email confirmation, and password reset landing page.

## JWT configuration
You can configure JWT generation by using the plugins configuration file.
The Users & Permissions feature supports 2 JWT management modes: legacy-support and refresh.
For backwards compatibility, the default is legacy mode.

## Registration configuration
If you have added additional fields in your User model that need to be accepted on registration, add them to the list of allowed fields in the config.register object of the /config/plugins file.

## Rate limiting configuration
Rate limiting is applied to authentication and registration endpoints to prevent abuse.
The following options are available in the /config/plugins file: ratelimit, ratelimit.enabled, ratelimit.interval, ratelimit.max, ratelimit.prefixKey.

## Security configuration
JWTs are digitally signed and require a secret.
By default, Strapi stores it as the JWT_SECRET environment variable in the .env file.

## Usage
When Users & Permissions is installed on a Strapi application, 3 collection types are automatically created, including User.
Registering new end users in a front-end application consists of adding a new entry to the User collection type.
Any request without a token will assume the public role permissions by default.
Authentication failures return a 401 unauthorized error.