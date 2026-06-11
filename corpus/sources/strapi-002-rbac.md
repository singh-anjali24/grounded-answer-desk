# Role-Based Access Control (RBAC)

- Source ID: strapi-002
- URL: https://docs.strapi.io/cms/features/rbac
- Topic: rbac
- Version: Strapi 5

## Content

> Page summary:
> Role-Based Access Control (RBAC) manages administrator roles and granular permissions in the admin panel. This documentation covers creating roles, assigning rights, and securing administrative workflows.

The Role-Based Access Control (RBAC) feature allows the management of the administrators, who are the users of the admin panel. More specifically, RBAC manages the administrators' accounts and roles.

## Configuration

**Path to configure the feature:** *Settings > Administration panel > Roles*

The *Roles* interface displays all created roles for the administrators of your Strapi application.

From this interface, it is possible to:

- create a new administrator role,
- delete an administrator role,
- or access information regarding an administrator role, and edit it.

By default, 3 administrator roles are defined for any Strapi application:

- Author: to be able to create and manage their own content.
- Editor: to be able to create content, and manage and publish any content.
- Super Admin: to be able to access all features and settings.

### Creating a new role

On the top right side of the *Administration panel > Roles* interface, an **Add new role** button is displayed. Click on that **Add new role** button to create a new role for administrators of your Strapi application.

### Deleting a role

Administrator roles can be deleted from the *Administration panel > Roles* interface. However, they can only be deleted once they are no more attributed to any administrator of the Strapi application.

### Editing a role

The role edition interface allows to edit the details of an administrator role as well as configure in detail the permissions to all sections of your Strapi application.

It isn't possible to edit the permissions of the Super Admin role. All configurations are in read-only mode.

The permissions area of an administrator role editing interface allows to configure in detail what actions an administrator can do for any part of the Strapi application.

It is displayed as a table, split into 4 categories: Collection types, Single types, Plugins and Settings.

For each content-type, the administrators can have the permission to perform the following actions: create, read, update, delete and publish.

By default, packages permissions can be configured for the Content-type Builder, Upload, the Content Manager, and Users & Permissions.

### Setting custom conditions for permissions

For each permission of each category, a **Settings** button is displayed. It allows to push the permission configuration further by defining additional conditions for the administrators to be granted the permission.

There are 2 default additional conditions:

- the administrator must be the creator,
- the administrator must have the same role as the creator.

Other custom conditions can be available if they have been created beforehand for your Strapi application.

## Usage

**Path to use the feature:** *Settings > Administration panel > Users*

The *Users* interface displays a table listing all the administrators of your Strapi application.

From this interface, it is possible to:

- make a textual search to find specific administrators,
- set filters to find specific administrators,
- create a new administrator account,
- delete an administrator account,
- or access information regarding an administrator account, and edit it.

### Creating a new account

Click on the **Invite new user** button, fill in the administrator details and login settings, then send the invitation URL.

### Editing an account

You can edit administrator details including first name, last name, email, username, password, active status, and assigned roles. 
