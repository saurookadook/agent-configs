# NestJS Standards

Applies to `backend/src`. Database rules are in [mongoose.md](mongoose.md), the WebSocket
gateway in [websockets.md](websockets.md), and general rules in
[typescript.md](typescript.md) and [nodejs.md](nodejs.md).

**Stack:** NestJS on Express, `@nestjs/mongoose`, `@nestjs/config`, `@nestjs/passport`
(local strategy with server-side sessions), `@nestjs/platform-ws`, `class-validator` and
`class-transformer`, and `nest-commander` for CLI scripts.

---

## Layout and file names

**NEST-1 — Use one folder per feature and one class per file.** File names are kebab-case
with a role suffix:

```txt
src/
  main.ts                       bootstrap only
  app.module.ts                 root module, global middleware
  auth/
    auth.module.ts
    auth.controller.ts
    authentication.service.ts
    authentication.serializer.ts
    decorators/public.decorator.ts
    dtos/auth.dto.ts
    guards/logged-in.guard.ts
    strategies/local.strategy.ts
  projects/
    projects.module.ts
    projects.controller.ts
    projects.service.ts
    tasks/                      sub-feature: its own module, controller, service
    events/                     WebSocket gateway and its module
    dtos/  schemas/
  users/
  config/  constants/  database/  dtos/  filters/  middleware/  pipes/  decorators/
  scripts/                      nest-commander CLI
  utils/  types/  __mocks__/
```

Suffixes: `.module`, `.controller`, `.service`, `.gateway`, `.dto`, `.schema`, `.guard`,
`.strategy`, `.serializer`, `.filter`, `.pipe`, `.middleware`, `.decorator`,
`.providers`, `.config`, `.command`. Each folder that groups one kind of file (`dtos/`,
`guards/`, `schemas/`) has an `index.ts` barrel.

**NEST-2 — Name feature folders and route prefixes with the plural resource name**
(`users`, `projects`), unless the feature is a capability rather than a resource (`auth`,
`search`).

**NEST-3 — `main.ts` only bootstraps the app:** create it, configure CORS from config, set
the global `api` prefix, attach the WebSocket adapter, and listen. Wire everything else
(middleware, filters, config) through modules.

---

## Modules

**NEST-4 — Module metadata keys appear in the order `controllers`, `imports`,
`providers`, `exports`**, with the entries in each array sorted alphabetically.

```ts
@Module({
  controllers: [TasksController],
  imports: [
    MongooseModule.forFeature([{ name: Task.name, schema: TaskSchema }]),
    AuthModule,
    UsersModule,
  ],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
```

**NEST-5 — A module exports only the providers that other modules need** (usually its
service). A consumer imports that module; it never lists another module's service in its
own `providers`.

**NEST-6 — Register a schema with `MongooseModule.forFeature` only in the module that owns
the collection.** Other features reach that data through the owning module's service.

**NEST-7 — Declare global providers with DI tokens in a `*.providers.ts` file**
(`{ provide: APP_FILTER, useClass: HttpExceptionFilter }`), and add them to
`AppModule.providers`.

---

## Configuration

**NEST-8 — Load configuration in one `RootConfigModule`** that calls
`ConfigModule.forRoot({ isGlobal: true, load: [baseConfig], envFilePath })`, where
`envFilePath` is `.env.test` under test and `.env` otherwise. `AppModule` and tests both
import `RootConfigModule`; nothing else calls `forRoot`.

**NEST-9 — Read config through `ConfigService.get('section.key')`**, not `process.env`
([nodejs.md](nodejs.md) NODE-8). Helpers that build derived values (such as
`buildConnectionURI(configService)`) live in `config/`.

---

## Controllers

**NEST-10 — Keep controllers thin.** A controller validates input, calls one or more
services, and shapes the response. Business rules, database access, and cross-entity
checks belong in services.

**NEST-11 — Inject dependencies through the constructor as `private readonly`:**
`constructor(private readonly tasksService: TasksService) {}`.

**NEST-12 — Route paths are kebab-case, and path parameters are camelCase ending in
`ID`** (`@Get('history/:userID')`, `@Get(':projectID')`). Declare static segments such as
`all` or `history/...` before a bare `:param` route, so the static routes match first.

**NEST-13 — Validate every path and query parameter with a pipe.** Use `ParseUUIDPipe`
for UUIDs and `ParseObjectIdPipe` for MongoDB ids. For an optional query parameter, use
`new ParseUUIDPipe({ optional: true })`.

**NEST-14 — Validate every request body with a DTO validation pipe on `@Body`:**
`@Body(DTOValidationPipe) createTaskDTO: CreateTaskDTO`. The pipe runs `plainToInstance`
and `validate`, and throws `BadRequestException` with the validation errors as its
`cause`. Authentication routes are not exempt.

**NEST-15 — Every handler MUST declare its return type and wrap its response in a named
envelope**, never return a bare array or document:

```ts
@Get('all')
async getAllProjects(): Promise<{ projects: ProjectDTO[] }> {
  const projects = await this.projectsService.findAll();
  return { projects: projects.map(toProjectDTO) };
}
```

Use a singular key for one resource (`{ project }`) and a plural key for a collection
(`{ projects }`). Any `statusCode` in the body MUST match the HTTP status.

**NEST-16 — Convert documents to DTOs before returning them**, using
`plainToInstance(XDTO, document.toJSON())` or a shared transform in `utils/transforms.ts`
when references must be populated. Never return a Mongoose document directly.

**NEST-17 — Use `@Req()` and `@Res()` only when a handler needs the session or
cookies.** When you do, write `@Res({ passthrough: true })` so Nest still serializes the
return value.

---

## Authentication and authorization

**NEST-18 — Authentication uses Passport with server-side sessions.** A `LocalAuthGuard`
authenticates the login route, and a `LoggedInGuard` checks
`request.isAuthenticated()` on protected routes.

**NEST-19 — Every route MUST either use `@UseGuards(LoggedInGuard)` or be explicitly
marked `@Public()`.** No route is public by accident.

**NEST-20 — Configure session cookies once, in `AppModule.configure`.** They MUST be
`httpOnly`; in production they MUST also be `secure` and `sameSite: 'strict'` (use
`'lax'` in development). Store sessions in MongoDB in development and production.

**NEST-21 — CORS allows only the app's own origins**, read from config. Never combine
`Access-Control-Allow-Origin: *` with credentialed requests.

---

## DTOs and validation

**NEST-22 — DTO classes use an allowlist:** `@Exclude()` on the class and `@Expose()` on
every field allowed to cross the boundary. Rename a field at the boundary with
`@Expose({ name: '...' })` (`_id` → `id`, `password` → `unhashedPassword`).

```ts
@Exclude()
export class CreateTaskDTO {
  @Expose()
  @IsMongoId()
  projectID: TaskDTO['projectID'];

  @Expose()
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskDTO['status'];
}
```

**NEST-23 — Name DTOs `<Entity>DTO`, `Create<Entity>DTO`, and `Update<Entity>DTO`.**
Response DTOs extend a `BaseDTO` (`id`, `createdAt`, `updatedAt`). Update DTOs extend a
`PartialBaseDTO` and mark every field `@IsOptional()`. Take field types from the base DTO
by indexed access (`TaskDTO['projectID']`).

**NEST-24 — Every DTO field has at least one `class-validator` decorator.** Fields that are
optional MUST be `@IsOptional()`. Use shared validation patterns for formats the frontend
also checks (`@Matches(usernamePattern.asRegExp)`), and `@ValidateIf((o) => o.x != null)`
for nullable fields.

**NEST-25 — Response DTOs MUST NOT expose secrets.** Never `@Expose()` a `password` (or
any other credential) on a response DTO.

---

## Services

**NEST-26 — Services are `@Injectable()` classes, and their data-access methods use this
vocabulary:**

| Operation      | Name                                                    |
| -------------- | ------------------------------------------------------- |
| create         | `createOne`                                             |
| read one       | `findOneById`, `findOneBy<Field>` (`findOneByUserID`)   |
| read many      | `findAll`, `findAllFor<Owner>` (`findAllForUser`)       |
| update         | `updateOne(id, dto)`                                    |
| delete         | `deleteOneById`, `deleteOneBy<Field>`                   |
| find-or-create | `_findOrCreate<Entity>`                                 |
| precondition   | `_validate<Thing>` (throws, or returns the entity)      |

**NEST-27 — `findOne*` methods return `Nullable<XDocument>`;** the caller decides whether
`null` is an error. A method that requires the entity to exist throws
`NotFoundException`.

**NEST-28 — Services take DTO-typed inputs** (`createOne(task: CreateTaskDTO)`) and return
documents. Controllers convert those documents into response DTOs.

**NEST-29 — Pure domain logic lives in `shared`**, where it can be tested without Nest and
reused by the frontend. Services instantiate or inject it; they do not reimplement domain
rules.

---

## Errors

**NEST-30 — Throw Nest HTTP exceptions for failures the client caused**
(`BadRequestException`, `UnauthorizedException`, `ForbiddenException`,
`NotFoundException`). Prefix the message with its location (see
[logging-and-errors.md](logging-and-errors.md) LOG-7):

```ts
throw new NotFoundException(
  `[TasksService.findAllForUser] : User with userID '${userID}' not found`,
);
```

Invalid credentials throw `UnauthorizedException`.

**NEST-31 — Wrap unexpected lower-level errors** in
`new Error('[Class.method] : ERROR doing X - ' + error.message, { cause: error })`, and
let the global filter respond.

**NEST-32 — Error responses have the shape `{ message?, path, statusCode, timestamp }`**,
and only the global `HttpExceptionFilter` / `CatchAllFilter` produce them. Include
`message` for 4xx responses only.

---

## Scripts

**NEST-33 — Write one-off and maintenance tasks as `nest-commander` commands** in
`scripts/commands/<name>.command.ts`, register them in a `ScriptsModule`, and run them
with `pnpm backend:ncs <command_name>`. Command names are `snake_case` (`seed_db`). One-off
data migrations go in `scripts/commands/adhoc/`.
