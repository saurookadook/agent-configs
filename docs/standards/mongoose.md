# MongoDB / Mongoose Standards

Applies to schemas, models, and queries in `backend/src`. Nest module wiring is in
[nestjs.md](nestjs.md).

**Stack:** MongoDB (the Compose `mongo` service), Mongoose via `@nestjs/mongoose`.

---

## Schemas

**MONGO-1 — Define each schema as a decorated class in
`<feature>/schemas/<entity>.schema.ts`**, one entity per file, and export these four
things:

```ts
@Schema({ collection: 'users' })
export class User {
  @Prop({ required: true, type: Types.UUID, unique: true })
  userID: UserID;
  ...
}

export type UserDocument = HydratedDocument<User>;
export type NullableUserDocument = UserDocument | null;
export const UserSchema = SchemaFactory.createForClass(User);
```

When a document has populated references, pass an override type as the second
`HydratedDocument` argument (`ProjectDocumentOverride`).

**MONGO-2 — Collection names are `snake_case` plurals** (`users`, `projects`,
`task_comments`, `user_sessions`). Set each name explicitly with the `collection` option.
Do not rely on Mongoose's automatic pluralization.

**MONGO-3 — Every `@Prop` declares `type` unless the field is a plain string, number, or
boolean, and declares `required: true` when the field must always be present.** Use
`default` for initial values (`default: ProjectStatus.ACTIVE`, `default: []`).

**MONGO-4 — Every collection has `createdAt` and `updatedAt`.** Enable them with
`@Schema({ timestamps: true })` so Mongoose maintains them on create and update.

**MONGO-5 — Enum-valued fields store the enum's string value** and declare it in the
schema (`enum: Object.values(ProjectStatus)`).

**MONGO-6 — Expiring data uses a TTL index with a named constant**
(`index: { expires: DRAFTS_TTL_SECONDS }`). Changing a TTL requires dropping the old index
on startup or in a migration command, because MongoDB does not update it in place.

---

## Identifiers

**MONGO-7 — Keep public IDs separate from database IDs:**

| Name              | Type                    | Use                                                       |
| ----------------- | ----------------------- | --------------------------------------------------------- |
| `userID`          | UUID (`Types.UUID`)     | public, stable identifier for user-facing entities; safe in URLs and events |
| `_id`             | `ObjectId`              | internal primary key                                      |
| `<thing>ObjectID` | `ObjectId`              | an `_id` carried in a DTO or payload (`ownerObjectID`)   |
| `id`              | `string`                | `_id` serialized in a response DTO (`@Expose({ name: '_id' })`) |
| `projectID`       | `string` (ObjectId hex) | reference to another document in a payload               |

Name references with the `ID` suffix ([typescript.md](typescript.md) TS-4). Where a
`string` holds an ID, add a `@note` saying which kind.

**MONGO-8 — References use `type: Types.ObjectId` with `ref: Entity.name`.** Convert
incoming strings with `new Types.ObjectId(id)` at the service boundary.

---

## Queries

**MONGO-9 — End every query with `.exec()`** so it returns a real promise with a useful
stack trace.

**MONGO-10 — Populate only the fields you need:**
`.populate(['owner', 'assignee'], 'userID username')`.

**MONGO-11 — Exclude secrets by default.** Mark credential fields `select: false` in the
schema. The authentication path opts back in with `.select('+password')`.

**MONGO-12 — Updates return the new document** (`findByIdAndUpdate(id, fields,
{ new: true })`). The service builds an explicit update object, leaving out absent
fields, rather than passing a DTO straight through.

**MONGO-13 — Any read that returns many documents specifies a sort**
(`.sort({ updatedAt: -1 })`).

**MONGO-14 — Export filter and sort option types from the service**
(`UserFilterOptions`, `SortOptions`) so controllers can build them type-safely.

---

## Connections and tokens

**MONGO-15 — Configure the connection once, in `database/database.providers.ts`**, with
`MongooseModule.forRootAsync` and a URI from `buildConnectionURI(configService)`.

**MONGO-16 — Keep model and connection DI tokens as constants in `constants/db.ts`**
(`USER_MODEL_TOKEN = getModelToken(User.name)`). Tests use them to resolve models.

**MONGO-17 — Inject models with `@InjectModel(Entity.name)`, typed as
`Model<EntityDocument>`.**
