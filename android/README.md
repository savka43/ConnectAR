# ConnectAR — Android

Клиент ещё не создан. Здесь будет Android-проект (Kotlin, Jetpack Compose, ARCore).

Данные плат берутся из [`../shared_boards`](../shared_boards): при сборке `shared_boards/boards/**` подключается как assets (например, через `sourceSets["main"].assets.srcDir("../shared_boards")`), а не копируется вручную.
