package com.alecocluc.androidls.xml

import com.alecocluc.androidls.project.ProjectModel
import java.io.File
import javax.xml.parsers.SAXParserFactory
import org.xml.sax.Attributes
import org.xml.sax.helpers.DefaultHandler

/**
 * Loads and provides the Android XML attribute schema.
 * 
 * Parses attrs.xml from the Android SDK platforms directory to build a complete
 * model of which XML elements support which attributes and what values they accept.
 * 
 * This is the same data source Android Studio uses for XML autocomplete.
 * Location: android_sdk/platforms/android-XX/data/res/values/attrs.xml
 */
class XmlSchemaProvider(private val projectModel: ProjectModel) {

    // Element → list of allowed attributes
    private val elementAttributes = mutableMapOf<String, MutableList<AttributeSchema>>()
    
    // Attribute name → schema (for global attributes like android:id, android:layout_width)
    private val globalAttributes = mutableMapOf<String, AttributeSchema>()
    
    // All known view classes
    private val viewClasses = mutableSetOf<String>()
    
    // Manifest schema
    private val manifestElements = mutableMapOf<String, MutableList<AttributeSchema>>()

    val attributeCount: Int get() = globalAttributes.size + elementAttributes.values.sumOf { it.size }

    data class AttributeSchema(
        val name: String,
        val format: Set<AttributeFormat>,
        val enumValues: List<EnumValue> = emptyList(),
        val flagValues: List<EnumValue> = emptyList(),
        val description: String = "",
        val isRequired: Boolean = false
    )
    
    data class EnumValue(val name: String, val value: String)
    
    enum class AttributeFormat {
        BOOLEAN, COLOR, DIMENSION, ENUM, FLAGS, FLOAT, FRACTION,
        INTEGER, REFERENCE, STRING;
        
        companion object {
            fun parse(formatStr: String): Set<AttributeFormat> {
                return formatStr.split('|').mapNotNull { part ->
                    entries.find { it.name.equals(part.trim(), ignoreCase = true) }
                }.toSet()
            }
        }
    }

    /**
     * Initialize the schema by parsing attrs.xml from the SDK.
     */
    fun initialize() {
        val sdkHome = resolveSdkHome() ?: run {
            // No SDK found — load built-in defaults
            loadDefaultSchema()
            return
        }
        
        // Find the highest installed platform
        val platformsDir = File(sdkHome, "platforms")
        val latestPlatform = platformsDir.listFiles()
            ?.filter { it.isDirectory && it.name.startsWith("android-") }
            ?.maxByOrNull { it.name.removePrefix("android-").toIntOrNull() ?: 0 }
        
        if (latestPlatform == null) {
            loadDefaultSchema()
            return
        }
        
        // Parse attrs.xml
        val attrsFile = File(latestPlatform, "data/res/values/attrs.xml")
        if (attrsFile.exists()) {
            parseAttrsXml(attrsFile)
        }
        
        // Parse attrs_manifest.xml
        val manifestAttrsFile = File(latestPlatform, "data/res/values/attrs_manifest.xml")
        if (manifestAttrsFile.exists()) {
            parseManifestAttrsXml(manifestAttrsFile)
        }
        
        // Load known view classes
        loadViewClasses(latestPlatform)
    }
    
    /**
     * Parse the SDK's attrs.xml to extract all widget attribute definitions.
     */
    private fun parseAttrsXml(file: File) {
        try {
            val factory = SAXParserFactory.newInstance()
            factory.isNamespaceAware = false
            val parser = factory.newSAXParser()
            
            parser.parse(file, object : DefaultHandler() {
                private var currentStyleable: String? = null
                private var currentAttrName: String? = null
                private var currentFormats = mutableSetOf<AttributeFormat>()
                private var currentEnums = mutableListOf<EnumValue>()
                private var currentFlags = mutableListOf<EnumValue>()
                private var inEnum = false
                private var inFlag = false
                
                override fun startElement(uri: String?, localName: String?, qName: String, attrs: Attributes) {
                    when (qName) {
                        "declare-styleable" -> {
                            currentStyleable = attrs.getValue("name")
                        }
                        "attr" -> {
                            val name = attrs.getValue("name") ?: return
                            currentAttrName = name
                            val format = attrs.getValue("format")
                            currentFormats = if (format != null) {
                                AttributeFormat.parse(format).toMutableSet()
                            } else {
                                mutableSetOf()
                            }
                            currentEnums = mutableListOf()
                            currentFlags = mutableListOf()
                            inEnum = false
                            inFlag = false
                        }
                        "enum" -> {
                            inEnum = true
                            val name = attrs.getValue("name") ?: return
                            val value = attrs.getValue("value") ?: return
                            currentEnums.add(EnumValue(name, value))
                            currentFormats.add(AttributeFormat.ENUM)
                        }
                        "flag" -> {
                            inFlag = true
                            val name = attrs.getValue("name") ?: return
                            val value = attrs.getValue("value") ?: return
                            currentFlags.add(EnumValue(name, value))
                            currentFormats.add(AttributeFormat.FLAGS)
                        }
                    }
                }
                
                override fun endElement(uri: String?, localName: String?, qName: String) {
                    when (qName) {
                        "attr" -> {
                            val attrName = currentAttrName ?: return
                            val schema = AttributeSchema(
                                name = attrName,
                                format = currentFormats.toSet(),
                                enumValues = currentEnums.toList(),
                                flagValues = currentFlags.toList()
                            )
                            
                            val styleable = currentStyleable
                            if (styleable != null) {
                                elementAttributes.getOrPut(styleable) { mutableListOf() }.add(schema)
                            }
                            
                            // Also add as global attribute
                            if (!globalAttributes.containsKey(attrName)) {
                                globalAttributes[attrName] = schema
                            }
                            
                            currentAttrName = null
                        }
                        "declare-styleable" -> {
                            currentStyleable = null
                        }
                    }
                }
            })
        } catch (e: Exception) {
            System.err.println("Failed to parse attrs.xml: ${e.message}")
        }
    }
    
    /**
     * Parse manifest-specific attributes.
     */
    private fun parseManifestAttrsXml(file: File) {
        try {
            val factory = SAXParserFactory.newInstance()
            factory.isNamespaceAware = false
            val parser = factory.newSAXParser()
            
            parser.parse(file, object : DefaultHandler() {
                private var currentElement: String? = null
                
                override fun startElement(uri: String?, localName: String?, qName: String, attrs: Attributes) {
                    when (qName) {
                        "declare-styleable" -> {
                            currentElement = attrs.getValue("name")
                        }
                        "attr" -> {
                            val name = attrs.getValue("name") ?: return
                            val format = attrs.getValue("format")
                            val formats = if (format != null) AttributeFormat.parse(format) else emptySet()
                            
                            val element = currentElement
                            if (element != null) {
                                manifestElements.getOrPut(element) { mutableListOf() }.add(
                                    AttributeSchema(name = name, format = formats)
                                )
                            }
                        }
                    }
                }
                
                override fun endElement(uri: String?, localName: String?, qName: String) {
                    if (qName == "declare-styleable") currentElement = null
                }
            })
        } catch (e: Exception) {
            System.err.println("Failed to parse manifest attrs: ${e.message}")
        }
    }
    
    /**
     * Load known Android View subclasses.
     */
    private fun loadViewClasses(platform: File) {
        // Common view classes — these should come from the platform's API data
        // but for now we use a comprehensive built-in list
        viewClasses.addAll(COMMON_VIEW_CLASSES)
    }
    
    /**
     * Load a default schema when the SDK is not available.
     */
    private fun loadDefaultSchema() {
        // Add essential layout attributes
        val layoutParams = listOf(
            AttributeSchema("layout_width", setOf(AttributeFormat.DIMENSION, AttributeFormat.ENUM), 
                listOf(EnumValue("match_parent", "-1"), EnumValue("wrap_content", "-2"))),
            AttributeSchema("layout_height", setOf(AttributeFormat.DIMENSION, AttributeFormat.ENUM),
                listOf(EnumValue("match_parent", "-1"), EnumValue("wrap_content", "-2"))),
            AttributeSchema("layout_margin", setOf(AttributeFormat.DIMENSION)),
            AttributeSchema("layout_marginTop", setOf(AttributeFormat.DIMENSION)),
            AttributeSchema("layout_marginBottom", setOf(AttributeFormat.DIMENSION)),
            AttributeSchema("layout_marginStart", setOf(AttributeFormat.DIMENSION)),
            AttributeSchema("layout_marginEnd", setOf(AttributeFormat.DIMENSION)),
            AttributeSchema("layout_gravity", setOf(AttributeFormat.FLAGS)),
            AttributeSchema("layout_weight", setOf(AttributeFormat.FLOAT)),
        )
        
        val viewAttrs = listOf(
            AttributeSchema("id", setOf(AttributeFormat.REFERENCE)),
            AttributeSchema("visibility", setOf(AttributeFormat.ENUM),
                listOf(EnumValue("visible", "0"), EnumValue("invisible", "4"), EnumValue("gone", "8"))),
            AttributeSchema("padding", setOf(AttributeFormat.DIMENSION)),
            AttributeSchema("paddingTop", setOf(AttributeFormat.DIMENSION)),
            AttributeSchema("paddingBottom", setOf(AttributeFormat.DIMENSION)),
            AttributeSchema("paddingStart", setOf(AttributeFormat.DIMENSION)),
            AttributeSchema("paddingEnd", setOf(AttributeFormat.DIMENSION)),
            AttributeSchema("background", setOf(AttributeFormat.REFERENCE, AttributeFormat.COLOR)),
            AttributeSchema("alpha", setOf(AttributeFormat.FLOAT)),
            AttributeSchema("elevation", setOf(AttributeFormat.DIMENSION)),
            AttributeSchema("clickable", setOf(AttributeFormat.BOOLEAN)),
            AttributeSchema("focusable", setOf(AttributeFormat.BOOLEAN)),
            AttributeSchema("contentDescription", setOf(AttributeFormat.STRING)),
        )
        
        val textViewAttrs = listOf(
            AttributeSchema("text", setOf(AttributeFormat.STRING, AttributeFormat.REFERENCE)),
            AttributeSchema("textColor", setOf(AttributeFormat.COLOR, AttributeFormat.REFERENCE)),
            AttributeSchema("textSize", setOf(AttributeFormat.DIMENSION)),
            AttributeSchema("textStyle", setOf(AttributeFormat.FLAGS)),
            AttributeSchema("fontFamily", setOf(AttributeFormat.STRING)),
            AttributeSchema("gravity", setOf(AttributeFormat.FLAGS)),
            AttributeSchema("hint", setOf(AttributeFormat.STRING, AttributeFormat.REFERENCE)),
            AttributeSchema("maxLines", setOf(AttributeFormat.INTEGER)),
            AttributeSchema("ellipsize", setOf(AttributeFormat.ENUM)),
            AttributeSchema("inputType", setOf(AttributeFormat.FLAGS)),
        )
        
        for (attr in layoutParams) globalAttributes[attr.name] = attr
        for (attr in viewAttrs) globalAttributes[attr.name] = attr
        
        elementAttributes["View"] = (viewAttrs + layoutParams).toMutableList()
        elementAttributes["TextView"] = (viewAttrs + layoutParams + textViewAttrs).toMutableList()
        
        viewClasses.addAll(COMMON_VIEW_CLASSES)
    }

    // ─── Query API ────────────────────────────────────────────────────────────

    /**
     * Get attributes for a given element/view class name.
     * Includes inherited attributes from View.
     */
    fun getAttributesForElement(elementName: String): List<AttributeSchema> {
        val attrs = mutableListOf<AttributeSchema>()
        
        // Element-specific attributes
        val styleableName = elementName.substringAfterLast('.')
        elementAttributes[styleableName]?.let { attrs.addAll(it) }
        
        // ViewGroup_Layout params
        elementAttributes["ViewGroup_Layout"]?.let { attrs.addAll(it) }
        
        // View base attributes
        if (styleableName != "View") {
            elementAttributes["View"]?.let { attrs.addAll(it) }
        }
        
        // De-duplicate by name
        return attrs.distinctBy { it.name }
    }
    
    /**
     * Get manifest attributes for a given element.
     */
    fun getManifestAttributes(elementName: String): List<AttributeSchema> {
        return manifestElements[elementName.replaceFirstChar { it.uppercase() }] ?: emptyList()
    }
    
    /**
     * Get all known view classes for element name completion.
     */
    fun getViewClasses(): Set<String> = viewClasses
    
    /**
     * Get an attribute schema by name.
     */
    fun getAttributeSchema(name: String): AttributeSchema? = globalAttributes[name]

    /**
     * Resolve the Android SDK location.
     */
    private fun resolveSdkHome(): File? {
        val envPaths = listOf(
            System.getenv("ANDROID_HOME"),
            System.getenv("ANDROID_SDK_ROOT")
        )
        for (p in envPaths) {
            if (p != null) {
                val dir = File(p)
                if (dir.isDirectory) return dir
            }
        }
        
        val localProps = File(projectModel.rootDir, "local.properties")
        if (localProps.exists()) {
            val props = java.util.Properties()
            localProps.inputStream().use { props.load(it) }
            val sdkDir = props.getProperty("sdk.dir")
            if (sdkDir != null) {
                val dir = File(sdkDir)
                if (dir.isDirectory) return dir
            }
        }
        
        val home = System.getProperty("user.home")
        val commonPaths = listOf(
            "$home/Android/Sdk",
            "$home/Library/Android/sdk",
            "$home/AppData/Local/Android/Sdk"
        )
        for (p in commonPaths) {
            val dir = File(p)
            if (dir.isDirectory) return dir
        }
        
        return null
    }

    companion object {
        val COMMON_VIEW_CLASSES = setOf(
            // Core views
            "View", "ViewGroup", "ViewStub",
            // Layouts  
            "LinearLayout", "RelativeLayout", "FrameLayout", "ConstraintLayout",
            "CoordinatorLayout", "TableLayout", "TableRow", "GridLayout",
            "androidx.constraintlayout.widget.ConstraintLayout",
            "androidx.coordinatorlayout.widget.CoordinatorLayout",
            // Text
            "TextView", "EditText", "AutoCompleteTextView", "MultiAutoCompleteTextView",
            "TextInputLayout", "TextInputEditText",
            "com.google.android.material.textfield.TextInputLayout",
            "com.google.android.material.textfield.TextInputEditText",
            // Buttons
            "Button", "ImageButton", "FloatingActionButton", "ToggleButton",
            "RadioButton", "CheckBox", "Switch", "CompoundButton",
            "com.google.android.material.button.MaterialButton",
            "com.google.android.material.floatingactionbutton.FloatingActionButton",
            // Images
            "ImageView", "VideoView",
            // Lists
            "ListView", "GridView", "RecyclerView", "ScrollView",
            "HorizontalScrollView", "NestedScrollView", "ViewPager2",
            "androidx.recyclerview.widget.RecyclerView",
            "androidx.viewpager2.widget.ViewPager2",
            "androidx.core.widget.NestedScrollView",
            // Navigation
            "Toolbar", "BottomNavigationView", "NavigationView", "TabLayout",
            "com.google.android.material.appbar.MaterialToolbar",
            "com.google.android.material.bottomnavigation.BottomNavigationView",
            "com.google.android.material.navigation.NavigationView",
            "com.google.android.material.tabs.TabLayout",
            "com.google.android.material.appbar.AppBarLayout",
            "com.google.android.material.appbar.CollapsingToolbarLayout",
            // Containers
            "CardView", "AppBarLayout", "CollapsingToolbarLayout",
            "androidx.cardview.widget.CardView", "DrawerLayout",
            "androidx.drawerlayout.widget.DrawerLayout",
            // Pickers / Inputs
            "Spinner", "SeekBar", "ProgressBar", "RatingBar",
            "DatePicker", "TimePicker", "NumberPicker",
            "com.google.android.material.slider.Slider",
            "com.google.android.material.progressindicator.LinearProgressIndicator",
            "com.google.android.material.progressindicator.CircularProgressIndicator",
            // Material
            "com.google.android.material.chip.Chip",
            "com.google.android.material.chip.ChipGroup",
            "com.google.android.material.card.MaterialCardView",
            "com.google.android.material.switchmaterial.SwitchMaterial",
            // Fragments
            "fragment", "FragmentContainerView",
            "androidx.fragment.app.FragmentContainerView",
            // Other
            "WebView", "MapView", "SurfaceView", "TextureView",
            "Space", "include", "merge", "requestFocus",
            "com.google.android.material.divider.MaterialDivider",
        )
    }
}
