import org.gradle.api.Project
import org.gradle.api.publish.PublishingExtension
import org.gradle.api.publish.maven.MavenPublication
import org.gradle.kotlin.dsl.configure

/**
 * Every framework module publishes as ai.amberx.axf:<module>:<version> so apps can depend on the
 * framework by version (Maven local for development, GitHub Packages for releases).
 */
object AxfPublishing {
    fun configure(project: Project) = with(project) {
        group = findProperty("axf.group")?.toString() ?: "ai.amberx.axf"
        version = libs.findVersion("axf").get().toString()
        afterEvaluate {
            extensions.configure<PublishingExtension> {
                publications {
                    if (findByName("axf") == null) create("axf", MavenPublication::class.java) {
                        artifactId = project.name
                        val release = components.findByName("release")
                        val java = components.findByName("java")
                        from(release ?: java)
                    }
                }
                repositories {
                    mavenLocal()
                    maven {
                        name = "GitHubPackages"
                        url = uri("https://maven.pkg.github.com/MossesX/AmberX-AXF")
                        credentials {
                            username = System.getenv("GITHUB_ACTOR") ?: ""
                            password = System.getenv("GITHUB_TOKEN") ?: ""
                        }
                    }
                }
            }
        }
    }
}
