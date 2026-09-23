// Pixi drawing for the single map-space reference image.
class ReferenceImageRenderer {
    constructor(scene) {
        this.layer = scene.getLayer('referenceImage');
        this.source = null;
        this.sprite = null;
    }

    render() {
        const reference = window.referenceImage;
        const image = reference?.image;
        if (!image) {
            this.clear();
            return;
        }

        if (this.source !== image || !this.sprite) {
            this.clear();
            this.sprite = PIXI.Sprite.from(image);
            this.sprite.anchor.set(0);
            this.sprite.eventMode = 'none';
            this.layer.addChild(this.sprite);
            this.source = image;
        }

        this.sprite.anchor.set(0.5);
        this.sprite.position.set(reference.x + reference.width / 2, reference.y + reference.height / 2);
        this.sprite.width = reference.width;
        this.sprite.height = reference.height;
        this.sprite.rotation = (reference.rotation || 0) * Math.PI / 180;
        this.sprite.visible = reference.visible !== false;
        this.sprite.alpha = reference.opacity ?? 1;
    }

    clear() {
        if (this.sprite) {
            this.layer.removeChild(this.sprite);
            this.sprite.destroy({ texture: false, baseTexture: false });
            this.sprite = null;
        }
        this.source = null;
    }
}
