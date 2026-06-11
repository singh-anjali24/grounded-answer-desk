 # Models

- Source ID: strapi-005
- URL: https://docs.strapi.io/cms/backend-customization/models
- Topic: models
- Version: Strapi 5

## Content

> Page summary:
> Models define Strapi’s content structure via content-types and reusable components. This documentation walks through creating these models in the Content-type Builder or CLI and managing schema files with optional lifecycle hooks.

As Strapi is a headless Content Management System (CMS), creating a content structure for the content is one of the most important aspects of using the software. Models define a representation of the content structure.

There are 2 different types of models in Strapi:

- content-types, which can be collection types or single types,
- and components that are content structures re-usable in multiple content-types.

If you are just starting out, it is convenient to generate some models with the Content-type Builder directly in the admin panel.

## Model creation

Content-types in Strapi can be created with the Content-type Builder in the admin panel or with Strapi's interactive CLI `strapi generate` command.

The content-types use `schema.json` for the model's schema definition and `lifecycles.js` for lifecycle hooks.

These model files are stored in `./src/api/[api-name]/content-types/[content-type-name]/`.

Component models are stored in the `./src/components` folder.

## Model schema

The `schema.json` file of a model consists of:

- settings,
- information,
- attributes,
- and options used to define specific behaviors on the model.

### Model settings

General settings include parameters such as `collectionName` and `kind`.

### Model information

The `info` key in the model's schema describes information used to display the model in the admin panel and access it through the Content API.

It includes `displayName`, `singularName`, `pluralName`, and `description`.

### Model attributes

The content structure of a model consists of a list of attributes.

Many types of attributes are available:

- scalar types,
- `media`,
- `relation`,
- `customField`,
- `component`,
- `dynamiczone`,
- and `locale` / `localizations` for i18n.

Basic validations can be applied using parameters such as `required`, `max`, `min`, `minLength`, `maxLength`, `private`, and `configurable`.

### uid type

The `uid` type is used to automatically prefill the field value in the admin panel with a unique identifier based on optional parameters such as `targetField` and `options`.

### Relations

Relations link content-types together.

Strapi supports one-to-one, one-to-many, many-to-one, and many-to-many relations.

Relations are explicitly defined in the attributes of a model with `type: 'relation'`.

### Components

Component fields create a relation between a content-type and a component structure.

Components are explicitly defined in the attributes of a model with `type: 'component'`.

### Dynamic zones

Dynamic zones create a flexible space in which to compose content, based on a mixed list of components.

Dynamic zones are explicitly defined in the attributes of a model with `type: 'dynamiczone'`.

### Model options

The `options` key is used to define specific behaviors and accepts parameters such as `privateAttributes`, `draftAndPublish`, and `populateCreatorFields`.

### Plugin options

`pluginOptions` is an optional object allowing plugins to store configuration for a model or a specific attribute.

## Lifecycle hooks

Lifecycle hooks are functions that get triggered when Strapi queries are called.

Lifecycle hooks can be customized declaratively or programmatically.

Lifecycle hooks are not triggered when using directly the knex library instead of Strapi functions.

Available lifecycle events include `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete`, `afterDelete`, `beforeFindOne`, `afterFindOne`, `beforeFindMany`, and `afterFindMany` among others.
