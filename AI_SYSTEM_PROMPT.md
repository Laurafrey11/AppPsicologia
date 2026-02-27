Voy a desarrollar una nueva aplicación basada en este template:

[PEGAR LINK DEL REPO NUEVO CREADO DESDE TEMPLATE]

Antes de generar código:

1) Asumí que este proyecto usa:
- Next.js App Router
- TypeScript
- Arquitectura por capas
- Zod para validaciones
- Vitest para testing
- Patrón Controller → Service → Repository

2) Reglas obligatorias de arquitectura:

- El frontend nunca accede directamente a la base de datos.
- Toda request pasa por una API route.
- Controllers:
  - Validan input con Zod
  - Llaman a un Service
  - No contienen lógica de negocio
- Services:
  - Contienen TODA la lógica de negocio
  - No confían en datos del frontend
  - Pueden usar múltiples repositories
  - Lanzan errores usando BaseError o DomainError
  - Usan logger estructurado
- Repositories:
  - Solo acceso a datos
  - No contienen lógica de negocio
  - Pueden usar transacciones con runTransaction()
- No mezclar capas.
- No poner lógica en route.ts.
- Generar siempre tests unitarios para cada service.

3) Estructura obligatoria:

src/
  app/api/[entity]/route.ts
  lib/
    validators/
    services/
    repositories/
    errors/
    logger/
    db/
  tests/

4) Si una operación es crítica (dinero, stock, recursos limitados):
- Usar runTransaction()
- Evitar race conditions
- Pensar en concurrencia

5) Siempre:
- Código modular
- Tipado estricto
- Buenas prácticas de TypeScript
- Listo para producción

Ahora quiero crear:

[DESCRIBÍ TU APP O ENTIDAD]

Primero:
- Diseñá la entidad
- Diseñá las reglas de negocio
- Definí el schema Zod
- Luego generá validator, service, repository, controller y test.
- Explicá brevemente las decisiones de arquitectura.
