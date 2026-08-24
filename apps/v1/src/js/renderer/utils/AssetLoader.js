/**
 * AssetLoader.js - Carga de recursos gráficos
 * Gestiona la carga de texturas y sprites para PixiJS
 */

class AssetLoader {
    constructor() {
        this.textures = new Map();
        this.isLoaded = false;

        // 📱 OPTIMIZACIÓN MÓVIL: Detectar dispositivo para ajustar calidad de texturas
        this.isMobile = window.pixiApp && window.pixiApp.isMobile;
        this.textureScale = this.isMobile ? 0.5 : 1.0; // 50% resolución en móviles
        console.log(`🎨 Calidad de texturas: ${this.isMobile ? '📱 MÓVIL (50%)' : '🖥️ DESKTOP (100%)'}`);
    }

    async loadAssets() {
        console.log('📦 Cargando assets del motor gráfico...');

        const assets = [
            // Texturas de calles
            { name: 'carretera', url: 'assets/images/roads/carretera.png' },

            // Vehículos (6 tipos)
            { name: 'carro1', url: 'assets/images/vehicles/carro.png' },
            { name: 'carro2', url: 'assets/images/vehicles/carro2.png' },
            { name: 'carro3', url: 'assets/images/vehicles/carro3.png' },
            { name: 'carro4', url: 'assets/images/vehicles/carro4.png' },
            { name: 'carro5', url: 'assets/images/vehicles/carro5.png' },
            { name: 'carro6', url: 'assets/images/vehicles/carro6.png' },

            // Objetos de escenarios
            { name: 'cono', url: 'assets/images/objects/cono.png' },
            { name: 'bache', url: 'assets/images/objects/Bache.png' },
            { name: 'trabajador', url: 'assets/images/objects/Trabajador.png' },
            { name: 'arbol', url: 'assets/images/objects/Arbol.png' },
            { name: 'inundacion', url: 'assets/images/objects/Inundacion.png' },

            // Edificios
            { name: 'escom', url: 'assets/images/buildings/ESCOM.png' },
            { name: 'cic', url: 'assets/images/buildings/CIC.png' },
            { name: 'c.f.i.e', url: 'assets/images/buildings/C.F.I.E.png' },
            { name: 'planetario', url: 'assets/images/buildings/planetario.png' },
            { name: 'plaza torres lindavista', url: 'assets/images/buildings/torres_lindavista.png' },
            { name: 'alberca', url: 'assets/images/buildings/ALBERCA.png' },
            { name: 'campo burros blancos', url: 'assets/images/buildings/CAMPO BURROS BLANCOS ESTADIO WILFRIDO MASSIEU.png' },
            { name: 'establo de burros', url: 'assets/images/buildings/establo de burros.png' },
            { name: 'centro cultural jtb', url: 'assets/images/buildings/CENTRO CULTURAL JTB.png' },
            { name: 'dirección general', url: 'assets/images/buildings/Dirección General.png' },
            { name: 'edificio inteligente', url: 'assets/images/buildings/EDIFICIO INTELIGENTE.png' },
            { name: 'esime', url: 'assets/images/buildings/ESIME ESIQIE ESFM ETC.png' },
            { name: 'esime edificio 2', url: 'assets/images/buildings/ESIME ESIQIE ESFM ETC.png' },
            { name: 'esime edificio 3', url: 'assets/images/buildings/ESIME ESIQIE ESFM ETC.png' },
            { name: 'esime edificio 4', url: 'assets/images/buildings/ESIME ESIQIE ESFM ETC.png' },
            { name: 'esime edificio 5', url: 'assets/images/buildings/ESIME ESIQIE ESFM ETC.png' },
            { name: 'esfm', url: 'assets/images/buildings/ESIME ESIQIE ESFM ETC.png' },
            { name: 'esiqie edificio 7', url: 'assets/images/buildings/ESIME ESIQIE ESFM ETC.png' },
            { name: 'esiqie edificio 8', url: 'assets/images/buildings/ESIME ESIQIE ESFM ETC.png' },
            { name: 'esiquie', url: 'assets/images/buildings/ESIME ESIQIE ESFM ETC.png' },
            { name: 'esia', url: 'assets/images/buildings/ESIME ESIQIE ESFM ETC.png' },
            { name: 'estadio americano', url: 'assets/images/buildings/ESTADIO AMERICANO.png' },
            // Edificios administrativos
            { name: 'poi-ipn', url: 'assets/images/buildings/CIC.png' },
            { name: 'oic-ipn', url: 'assets/images/buildings/CIC.png' },
            { name: 'sad-ipn', url: 'assets/images/buildings/CIC.png' },
            { name: 'siis-ipn', url: 'assets/images/buildings/CIC.png' },
            { name: 'secademica-ipn', url: 'assets/images/buildings/CIC.png' },
            // Campos deportivos
            { name: 'beisbol', url: 'assets/images/buildings/campo beisbol.png' },
            { name: 'campo escom', url: 'assets/images/buildings/campo escom.png' },
            { name: 'campo tiro con arco', url: 'assets/images/buildings/campo tiro con arco.png' },
            { name: 'ciclovía', url: 'assets/images/buildings/ciclovia.png' },

            // Instalaciones deportivas y culturales
            { name: 'gimnasio', url: 'assets/images/buildings/GIMNASIO.png' },
            { name: 'cenlex', url: 'assets/images/buildings/cenlex.png' },

            // Edificios académicos adicionales
            { name: 'cidetec', url: 'assets/images/buildings/CIDETEC falta en el mapa.png' },
            { name: 'dae', url: 'assets/images/buildings/DAE_falta_en_el_mapa.png' },
            { name: 'cendi', url: 'assets/images/buildings/CIC.png' },
            { name: 'biblioteca', url: 'assets/images/buildings/CIC.png' },

            // Estacionamientos y EST
            { name: 'estacionamiento', url: 'assets/images/buildings/estacionamientos.png' },
            { name: 'est', url: 'assets/images/buildings/EST.png' }

            // NOTA: fondo.png removido - ahora usamos BackgroundAreaRenderer con PIXI.Graphics
            // para renderizar áreas de fondo de manera mucho más eficiente (vectorial vs textura pesada)
            // { name: 'fondo', url: 'assets/images/objects/fondo.png' }
        ];

        try {
            for (const asset of assets) {
                const texture = await PIXI.Assets.load(asset.url);

                // 📱 OPTIMIZACIÓN MÓVIL: Reducir resolución de texturas en móviles
                if (this.isMobile && texture.baseTexture) {
                    // Ajustar la resolución de la baseTexture
                    texture.baseTexture.setResolution(this.textureScale);
                }

                this.textures.set(asset.name, texture);
                console.log(`  ✓ ${asset.name}${this.isMobile ? ' (50%)' : ''}`);
            }

            this.isLoaded = true;
            console.log(`✅ Todos los assets del motor gráfico cargados${this.isMobile ? ' (optimizado para móvil)' : ''}`);
        } catch (error) {
            console.error('❌ Error cargando assets:', error);
            throw error;
        }
    }

    getTexture(name) {
        if (!this.textures.has(name)) {
            console.warn(`⚠️ Textura no encontrada: ${name}`);
            return PIXI.Texture.WHITE; // Fallback
        }
        return this.textures.get(name);
    }

    hasTexture(name) {
        return this.textures.has(name);
    }
}

window.AssetLoader = AssetLoader;
console.log('✓ AssetLoader cargado');
